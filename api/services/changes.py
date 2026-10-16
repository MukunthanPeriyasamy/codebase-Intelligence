"""Grounded, reviewable edits. Generation never writes to repository files."""
import asyncio
from contextlib import contextmanager
import difflib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import uuid

from pydantic import BaseModel, ConfigDict, Field

from api.chat import ChatStreamer, prompt_builder
from api.config import get_model_config
from api.prompts import EDIT_CODE_SYSTEM_PROMPT
from api.repository import Repo
from api.rag.pipeline import get_repo_db, count_tokens
from api.schemas import ChatCompletionRequest
from api.services.document_context import retrieve_documents, cross_check_sources, source_context
from api.services.source_files import safe_path, read_source, MAX_FILE
from api.services.developer_intent import resolve_intent, DEVELOPER_CONTRACT
from api.utils import deepwiki_root

MAX_CONTEXT = 250_000


class Edit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    action: str = "replace"
    start_line: int | None = Field(default=None, ge=1, strict=True)
    end_line: int | None = Field(default=None, ge=1, strict=True)
    old_text: str = Field(default="", max_length=MAX_FILE)
    new_text: str = Field(default="", max_length=MAX_FILE)


class EditPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(max_length=10_000)
    edits: list[Edit] = Field(max_length=12)


@contextmanager
def database():
    db = sqlite3.connect(Path(deepwiki_root()) / "changes.sqlite3", timeout=30)
    try:
        db.execute("CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        with db:
            yield db
    finally:
        db.close()


def resolve_line_edits(plan: EditPlan, sources: dict) -> EditPlan:
    """Ranges refer to the original snapshot; apply bottom-up, never fuzzy-match."""
    grouped = {}
    for edit in plan.edits:
        grouped.setdefault(edit.path, []).append(edit)
    resolved = []
    for name, edits in grouped.items():
        ranged = [e for e in edits if e.start_line is not None or e.end_line is not None]
        if not ranged:
            resolved.extend(edits)
            continue
        if name not in sources:
            raise ValueError(f"{name}: not present in the document-guided current source context. Do not invent this path. Regenerate function documentation or narrow the request; no changes applied")
        if len(ranged) != len(edits):
            raise ValueError(f"{name}: do not mix line-range edits with other edit formats")
        lines = sources[name].splitlines(keepends=True)
        end = 0
        for edit in sorted(ranged, key=lambda e: e.start_line or 0):
            if (edit.start_line is None or edit.end_line is None or edit.action not in ("replace", "delete")
                    or edit.end_line < edit.start_line or edit.end_line > len(lines) or edit.start_line <= end):
                raise ValueError(f"{name}: invalid or overlapping line ranges; use the original numbered source")
            if edit.action == "delete" and (edit.start_line != 1 or edit.end_line != len(lines) or edit.new_text):
                raise ValueError(f"{name}: file deletion must cover the entire original file")
            end = edit.end_line
        if any(e.action == "delete" for e in ranged):
            resolved.append(Edit(path=name, action="delete", old_text=sources[name]))
            continue
        newline = "\r\n" if "\r\n" in sources[name] else "\n"
        for edit in sorted(ranged, key=lambda e: e.start_line, reverse=True):
            replacement = edit.new_text.replace("\r\n", "\n").replace("\n", newline)
            # The range replaces full lines. Keep the separator to following lines.
            if replacement and lines[edit.end_line - 1].endswith("\n") and not replacement.endswith("\n"):
                replacement += newline
            lines[edit.start_line - 1:edit.end_line] = [replacement]
        resolved.append(Edit(path=name, old_text=sources[name], new_text="".join(lines)))
    return EditPlan(summary=plan.summary, edits=resolved)


def make_proposal(root: Path, plan: EditPlan, sources: dict, cache_path: str, evidence=None) -> dict:
    plan = resolve_line_edits(plan, sources)
    changes = {}
    canonical_paths = {}
    for edit in plan.edits:
        path = safe_path(root, edit.path)
        canonical = os.path.normcase(str(path))
        if canonical in canonical_paths and canonical_paths[canonical] != edit.path:
            raise ValueError("Duplicate file paths with different casing")
        canonical_paths[canonical] = edit.path
        if edit.action not in ("replace", "create", "delete"):
            raise ValueError("Unknown edit action")
        if edit.path not in changes:
            before = read_source(path)
            if edit.action != "create" and (edit.path not in sources or before != sources[edit.path]):
                raise ValueError("Edit is not grounded in the retrieved current source; regenerate")
            changes[edit.path] = {"path": edit.path, "before": before, "after": before}
        change = changes[edit.path]
        content = change["after"]
        if edit.action == "create":
            if content is not None or change["before"] is not None:
                raise ValueError("Cannot create an existing file")
            change["after"] = edit.new_text
        elif edit.action == "delete":
            if content is None or edit.old_text != content or edit.new_text:
                raise ValueError("Deletion must match the entire retrieved file")
            change["after"] = None
        else:
            if content is None or not edit.old_text or content.count(edit.old_text) != 1:
                count = content.count(edit.old_text) if content is not None and edit.old_text else 0
                raise ValueError(f"{edit.path}: replacement matched {count} source blocks; use valid original line ranges instead")
            change["after"] = content.replace(edit.old_text, edit.new_text, 1)
        if change["after"] is not None and len(change["after"].encode("utf-8")) > MAX_FILE:
            raise ValueError("Proposed file exceeds 100 KB")
        if change["after"] is not None and "\0" in change["after"]:
            raise ValueError("Binary content cannot be proposed")
    files = [c for c in changes.values() if c["before"] != c["after"]]
    if not files:
        raise ValueError(plan.summary or "No grounded changes could be proposed")
    for c in files:
        lines = difflib.unified_diff(
            (c["before"] or "").splitlines(keepends=True),
            (c["after"] or "").splitlines(keepends=True),
            fromfile="a/" + c["path"] if c["before"] is not None else "/dev/null",
            tofile="b/" + c["path"] if c["after"] is not None else "/dev/null")
        c["diff"] = "".join(line if line.endswith("\n") else line + "\n\\ No newline at end of file\n" for line in lines)
    proposal = dict(id=uuid.uuid4().hex, summary=plan.summary, root=str(root),
                    status="pending", files=files, cache_path=cache_path, documents=evidence or [], workflow_version=2)
    with database() as db:
        db.execute("INSERT INTO proposals VALUES (?, ?)", (proposal["id"], json.dumps(proposal)))
    return public(proposal)


def public(proposal):
    return {k: v for k, v in proposal.items() if k != "cache_path"}


def get_proposal(proposal_id: str):
    with database() as db:
        row = db.execute("SELECT payload FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    if not row:
        raise ValueError("Proposal not found")
    return public(json.loads(row[0]))


async def propose(request: ChatCompletionRequest):
    if not request.messages or request.messages[-1].role != "user":
        raise ValueError("A user instruction is required")
    # Documentation is mandatory, before any checkout/source access or model call.
    intent = resolve_intent(request.messages)
    query = intent.query
    evidence = await asyncio.to_thread(retrieve_documents, request, query)
    root, candidates, gaps = await asyncio.to_thread(cross_check_sources, request, evidence)
    model_config = get_model_config(request.provider, request.model)["model_kwargs"]
    history = json.dumps([{"role": m.role, "content": m.content} for m in request.messages[-9:-1] if m.role == "user"])[-12_000:]
    system = EDIT_CODE_SYSTEM_PROMPT + DEVELOPER_CONTRACT + "\nResolved developer intent: " + intent.contract
    base = prompt_builder(system, request.messages[-1].content, history, evidence.context)
    budget = min(24_000, int(model_config.get("num_ctx", 32_000) * 0.65)) - count_tokens(base)
    sources = {}
    for name, content in candidates.items():
        tokens = count_tokens(source_context({name: content}))
        if tokens <= budget:
            sources[name] = content
            budget -= tokens
        else:
            gaps.append(f"{name}: referenced by documentation but omitted from model context budget")
    if not sources:
        raise ValueError("Documentation found, but its referenced source could not be cross-checked within the model context. Regenerate documentation or narrow the request.")
    context = ("<generated_documents>\n" + evidence.context + "\n</generated_documents>\n"
               + "<current_source>\n" + source_context(sources) + "\n</current_source>\n"
               + "Editable existing paths (exact spelling only): " + json.dumps(list(sources))
               + "\nSource gaps: " + "; ".join(gaps))
    prompt = prompt_builder(system, request.messages[-1].content, history, context)
    streamer = ChatStreamer.create(provider=request.provider, model=request.model, model_config=model_config)
    # One bounded corrective attempt for local Ollama; never silently retry paid providers.
    attempts = 2 if request.provider == "ollama" else 1
    async with asyncio.timeout(900):
        for attempt in range(attempts):
            output = ""
            async for chunk in streamer.respond_stream(prompt):
                output += chunk
                if len(output) > 300_000:
                    raise ValueError("Proposed changes are too large; request a smaller change")
            output = re.sub(r"^```(?:json)?\s*|\s*```$", "", output.strip())
            try:
                plan = EditPlan.model_validate_json(output)
            except ValueError:
                reason = "Invalid edit JSON. Return only the specified JSON object with numbered source line ranges."
            else:
                if not plan.edits:
                    raise ValueError(plan.summary or "No changes proposed from the retrieved documentation")
                try:
                    return make_proposal(root, plan, sources, get_repo_db(Repo(request.repo_url, request.type)), evidence.provenance)
                except ValueError as exc:
                    reason = str(exc)
            # Store only validation metadata, not source or raw model output.
            diagnostic = {"provider": request.provider, "model": request.model, "attempt": attempt + 1,
                          "reason": reason, "document_pages": [d["page_id"] for d in evidence.provenance]}
            with (Path(deepwiki_root()) / "edit-validation.jsonl").open("a", encoding="utf-8") as log:
                log.write(json.dumps(diagnostic) + "\n")
            if attempt + 1 == attempts:
                raise ValueError("No changes applied. " + reason)
            prompt += "\n<validation_feedback>" + reason + " Regenerate the complete plan using the ORIGINAL numbered source above. Do not guess or copy old_text.</validation_feedback>"


def write_source(path: Path, text: str | None):
    if text is None:
        path.unlink()
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".deepwiki-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(text.encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
        if path.exists():
            os.chmod(temp, path.stat().st_mode)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def decide(proposal_id: str, action: str):
    if action not in ("accept", "reject"):
        raise ValueError("Choose accept or reject")
    with database() as db:
        # Serialize decisions across threads/processes, including repeated clicks.
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT payload FROM proposals WHERE id=?", (proposal_id,)).fetchone()
        if not row:
            raise ValueError("Proposal not found")
        p = json.loads(row[0])
        if p["status"] != "pending":
            return public(p)
        if action == "accept":
            if p.get("workflow_version") != 2 or not p.get("documents"):
                raise ValueError("This proposal lacks document-first evidence. Reject it and generate a new proposal from documentation.")
            root = Path(p["root"])
            if root.resolve() != root or not root.is_dir():
                raise ValueError("Repository location changed; regenerate the proposal")
            paths = [(safe_path(root, c["path"]), c) for c in p["files"]]
            for path, c in paths:
                if read_source(path) != c["before"]:
                    raise ValueError(f"{c['path']} changed since review. Nothing applied; regenerate the proposal.")
            # Invalidate before applying so subsequent retrieval cannot load stale embeddings.
            cache = Path(p["cache_path"])
            if cache.resolve().is_relative_to(Path(deepwiki_root()).resolve()):
                cache.unlink(missing_ok=True)
            written = []
            try:
                for path, c in paths:
                    write_source(path, c["after"])
                    written.append((path, c))
            except Exception:
                for path, c in reversed(written):
                    write_source(path, c["before"])
                raise
            p["status"] = "accepted"
        else:
            p["status"] = "rejected"
        db.execute("UPDATE proposals SET payload=? WHERE id=?", (json.dumps(p), proposal_id))
    return public(p)
