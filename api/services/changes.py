"""Grounded, reviewable edits. Generation never writes to repository files."""
import asyncio
from contextlib import contextmanager
import difflib
import json
import os
from pathlib import Path, PurePosixPath
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
from api.services.research import prepare_repo_index
from api.utils import deepwiki_root

MAX_FILE = 100_000
MAX_CONTEXT = 250_000


class Edit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    action: str = "replace"
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


def safe_path(root: Path, name: str) -> Path:
    """Reject traversal, metadata, links/junctions, Windows streams and devices."""
    parts = PurePosixPath(name).parts
    if (not parts or PurePosixPath(name).is_absolute() or name != "/".join(parts) or "\\" in name or ":" in name
            or any(p in (".", "..") or p.lower() == ".git" or p.endswith((".", " "))
                   or re.fullmatch(r"(?i)(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?", p)
                   for p in parts)):
        raise ValueError("Invalid repository-relative path")
    target = root.joinpath(*parts)
    if not target.resolve().is_relative_to(root):
        raise ValueError("Path escapes the repository")
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink() or (hasattr(current, "is_junction") and current.is_junction()):
            raise ValueError("Linked paths cannot be edited")
    return target


def read_source(path: Path) -> str | None:
    if not path.exists():
        return None
    if not path.is_file() or path.stat().st_size > MAX_FILE:
        raise ValueError("Only text files up to 100 KB can be edited")
    text = path.read_bytes().decode("utf-8")
    if "\0" in text:
        raise ValueError("Binary files cannot be edited")
    return text


def make_proposal(root: Path, plan: EditPlan, sources: dict, cache_path: str) -> dict:
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
                raise ValueError("Replacement must match exactly one source block")
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
                    status="pending", files=files, cache_path=cache_path)
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
    rag = await prepare_repo_index(request)
    repo = Repo(request.repo_url, request.type)
    root = Path(repo.save_path).resolve(strict=True)
    # Retrieve using the same native pipeline as chat; include preceding turns for follow-ups.
    query = "\n".join(m.content for m in request.messages[-5:])[-12_000:]
    matches = await rag.acall(query, language=request.language)
    model_config = get_model_config(request.provider, request.model)["model_kwargs"]
    history = json.dumps([{"role": m.role, "content": m.content} for m in request.messages[-9:-1]])[-20_000:]
    base_prompt = prompt_builder(EDIT_CODE_SYSTEM_PROMPT, request.messages[-1].content, history)
    budget = min(24_000, int(model_config.get("num_ctx", 32_000) * 0.65)) - count_tokens(base_prompt)
    if budget <= 0:
        raise ValueError("The conversation is too large for editing. Start a new chat with a focused request.")
    sources = {}
    size = 0
    for result in matches or []:
        for doc in result.documents or []:
            name = doc.meta_data.get("file_path", "")
            if name in sources:
                continue
            try:
                content = read_source(safe_path(root, name))
            except (ValueError, OSError, UnicodeError):
                continue
            tokens = count_tokens(json.dumps({name: content}, ensure_ascii=False)) if content is not None else 0
            if content is not None and size + len(content) <= MAX_CONTEXT and tokens <= budget and len(sources) < 12:
                sources[name] = content
                size += len(content)
                budget -= tokens
    if not sources:
        raise ValueError("No editable source retrieved. Specify the file or feature to change.")
    context = json.dumps(sources, ensure_ascii=False)
    prompt = prompt_builder(EDIT_CODE_SYSTEM_PROMPT, request.messages[-1].content, history, context)
    streamer = ChatStreamer.create(provider=request.provider, model=request.model,
                                   model_config=model_config)
    output = ""
    async with asyncio.timeout(900):
        async for chunk in streamer.respond_stream(prompt):
            output += chunk
            if len(output) > 300_000:
                raise ValueError("Proposed changes are too large; request a smaller change")
    output = re.sub(r"^```(?:json)?\s*|\s*```$", "", output.strip())
    try:
        plan = EditPlan.model_validate_json(output)
    except ValueError as exc:
        raise ValueError("The model did not return a valid change proposal. Try a smaller, specific request.") from exc
    return make_proposal(root, plan, sources, get_repo_db(repo))


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
