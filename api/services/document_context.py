"""Generated documentation is the entry point; source is only a cross-check.

No source index, source traversal, embedding request, or inference is performed
when documentation is absent or unrelated. Wiki generation is a separate flow.
"""
from collections import Counter
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import re
import logging
from urllib.parse import urlsplit, unquote

from api.repository import Repo
from api.schemas.base import RepoRequestBase
from api.services.source_files import safe_path, read_source
from api.utils import deepwiki_root
from api.services.document_schema import build_schema, route_schema
from api.services.document_vectors import semantic_scores
from api.services.developer_intent import resolve_intent

logger = logging.getLogger(__name__)

NO_DOCUMENT = "No document Found Generate One"


class NoDocumentError(ValueError):
    def __init__(self):
        super().__init__(NO_DOCUMENT)


def identity(value: str, repo_type: str) -> str:
    if repo_type == "local":
        return os.path.normcase(os.path.abspath(os.path.expanduser(value.strip()))).rstrip("/\\")
    url = urlsplit(value.strip())
    return (url.netloc.lower() + unquote(url.path).rstrip("/").removesuffix(".git")).lower()


def terms(text: str) -> list[str]:
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    stop = set("the a an to of in on for and or is are this that it with how what where which please change make update application codebase repository file user request".split())
    return [t for t in re.findall(r"[^\W_]+", text.lower()) if len(t) > 1 and t not in stop]


@dataclass
class DocumentEvidence:
    chunks: list[dict]

    @property
    def paths(self):
        return list(dict.fromkeys(p for c in self.chunks for p in c["files"]))

    @property
    def context(self):
        return "\n\n".join(f"## Generated document: {c['title']} (chunk {c['chunk']}; schema areas: {', '.join(c.get('areas', ['general']))})\n{c['text']}" for c in self.chunks)

    @property
    def provenance(self):
        return [{k: c[k] for k in ("page_id", "title", "chunk", "files", "areas") if k in c} for c in self.chunks]


def retrieve_documents(request: RepoRequestBase, query: str) -> DocumentEvidence:
    messages = getattr(request, "messages", None)
    intent = resolve_intent(messages) if messages else None
    if intent:
        query = intent.query
    cache_dir = Path(deepwiki_root()) / "wikicache"
    candidates = []
    if cache_dir.is_dir():
        # Filenames are not repository identity; validate stored URL/path and type.
        for cache in cache_dir.glob("deepwiki_cache_*.json"):
            if not cache.name.endswith(f"_{request.language}.json"):
                continue
            # Function/source reference pages are larger than summary-only wikis.
            if cache.is_symlink() or cache.stat().st_size > 128_000_000:
                continue
            try:
                data = json.loads(cache.read_text(encoding="utf-8"))
                info = data.get("repo") or {}
                url = info.get("localPath") or info.get("repoUrl") or data.get("repo_url")
                if not url or (info.get("type") and info["type"] != request.type):
                    continue
                if identity(url, request.type) != identity(request.repo_url, request.type):
                    continue
                pages = data.get("generated_pages")
                if isinstance(pages, dict):
                    candidates.append((cache.stat().st_mtime_ns, pages))
            except (ValueError, OSError, AttributeError, TypeError):
                continue
    if not candidates:
        raise NoDocumentError()
    pages = max(candidates, key=lambda item: item[0])[1]
    # Build from the cached documents only, including legacy caches. No code is
    # consulted to create the schema or select chunks.
    schema = build_schema(pages)
    _, routed_pages = route_schema(schema, query)
    routed_files = {path for page_id in routed_pages for path in schema["pages"][page_id]["files"]}
    connected_pages = {page_id for page_id, entry in schema["pages"].items()
                       if routed_files.intersection(entry["files"])}
    chunks = []
    for page_id, page in pages.items():
        if not isinstance(page, dict) or not isinstance(page.get("content"), str) or not page["content"].strip():
            continue
        title = str(page.get("title", page_id))
        paths = page.get("filePaths")
        files = [p.replace("\\", "/").removeprefix("./") for p in (paths if isinstance(paths, list) else []) if isinstance(p, str)]
        content = page["content"]
        entry = schema["pages"][page_id]
        for spec in entry["chunks"]:
            start = spec["start"]
            text = content[start:spec["end"]]
            chunks.append(dict(page_id=str(page_id), title=title, text=text,
                               chunk=start // 1600 + 1, files=files, areas=entry["areas"],
                               concepts=entry["concepts"], source_ranges=entry["source_ranges"]))
    query_terms = set(terms(query))
    if query_terms & {"theme", "color", "colour", "colors", "colours", "palette", "styling"}:
        query_terms.update({"theme", "color", "colors", "colour", "palette", "styling", "appearance"})
    tokens = [Counter(terms(c["text"] + " " + c["title"] + " " + " ".join(c["files"]))) for c in chunks]
    df = Counter(t for bag in tokens for t in bag)
    average = sum(sum(b.values()) for b in tokens) / max(1, len(tokens))
    ranked = []
    for chunk, bag in zip(chunks, tokens):
        score = sum(math.log(1 + (len(chunks) - df[t] + .5) / (df[t] + .5)) *
                    bag[t] * 2.2 / (bag[t] + 1.2 * (.25 + .75 * sum(bag.values()) / max(1, average)))
                    for t in query_terms if bag[t])
        score += 2 * len(set(terms(chunk["title"])) & query_terms)
        if score > 0:
            if chunk["page_id"] in routed_pages:
                score *= 1.5
            ranked.append((score, chunk))
    # Search the selected schema branches and their documented connections
    # first. If none match, widen only within the document index.
    scoped = [(score, chunk) for score, chunk in ranked if chunk["page_id"] in routed_pages | connected_pages]
    if scoped:
        ranked = scoped
    ranked.sort(key=lambda item: item[0], reverse=True)
    # Include semantically relevant chunks with no lexical overlap. Keep the
    # document-only candidate window bounded for local embedding providers.
    pool = ranked[:128]
    seen = {(c["page_id"], c["chunk"]) for _, c in pool}
    extras = [c for c in chunks if (c["page_id"], c["chunk"]) not in seen]
    extras.sort(key=lambda c: (c["page_id"] in routed_pages, bool(intent and intent.concept in c["concepts"])), reverse=True)
    pool += [(0, c) for c in extras[:max(0, 256 - len(pool))]]
    if not pool:
        raise NoDocumentError()
    vectors = semantic_scores(query, [c["title"] + "\n" + ", ".join(c["concepts"]) + "\n" + c["text"] for _, c in pool])
    semantic_order = sorted(range(len(pool)), key=lambda i: vectors[i], reverse=True) if vectors is not None else []
    positions = {index: rank for rank, index in enumerate(semantic_order)}
    fused = []
    for index, (lexical, chunk) in enumerate(pool):
        score = 1 / (60 + index + 1) if lexical > 0 else 0
        if vectors is not None and vectors[index] >= .4:
            score += 1 / (60 + positions[index] + 1)
        if not score:
            continue
        if intent and intent.concept in chunk["concepts"]:
            score *= 1.5
        chunk["retrieval_score"] = round(score, 6)
        fused.append((score, chunk))
    ranked = sorted(fused, key=lambda item: item[0], reverse=True)
    if not ranked:
        raise NoDocumentError()
    selected, per_file = [], Counter()
    for _, chunk in ranked:
        primary = chunk["files"][0] if chunk["files"] else chunk["page_id"]
        if per_file[primary] >= 2:
            continue
        selected.append(chunk)
        per_file[primary] += 1
        if len(selected) == 6:
            break
    logger.info("Document retrieval concept=%s mode=%s chunks=%s", intent.concept if intent else "general",
                "hybrid" if vectors is not None else "bm25", [(c["page_id"], c["chunk"], c["retrieval_score"]) for c in selected])
    return DocumentEvidence(selected)


def cross_check_sources(request: RepoRequestBase, evidence: DocumentEvidence, max_chars=180_000):
    # Called only after successful document retrieval. Never search unrelated code.
    root = Path(Repo(request.repo_url, request.type).save_path).resolve()
    if not root.is_dir():
        raise ValueError("Documentation found, but its source checkout is missing. Restore the repository and regenerate documentation.")
    sources = {}
    gaps = []
    for name in evidence.paths:
        try:
            content = read_source(safe_path(root, name))
            if content is None:
                gaps.append(f"{name}: missing from current code")
            elif len(sources) < 12 and sum(map(len, sources.values())) + len(content) <= max_chars:
                sources[name] = content
            else:
                gaps.append(f"{name}: outside source context budget")
        except (ValueError, OSError, UnicodeError):
            gaps.append(f"{name}: cannot safely read as supported text")
    return root, sources, gaps


def source_context(sources: dict[str, str]) -> str:
    return "\n\n".join(f"## File Path: {name}\n[lines 1-{len(text.splitlines())}]\n" +
        "\n".join(f"{i}: {line}" for i, line in enumerate(text.splitlines(), 1)) for name, text in sources.items())


def focused_source(name, text, evidence, query, max_lines=180):
    """Select bounded live lines only inside a document-referenced file."""
    lines = text.splitlines()
    wanted = set()
    priority = set()
    for chunk in evidence.chunks:
        for ref in chunk.get("source_ranges", []):
            if ref["file"] == name:
                wanted.update(range(max(1, ref["start_line"] - 4), min(len(lines), ref["end_line"] + 4) + 1))
    query_words = set(terms(query))
    for n, line in enumerate(lines, 1):
        if query_words.intersection(terms(line)):
            priority.update(range(max(1, n - 4), min(len(lines), n + 4) + 1))
    wanted.update(priority)
    if len(lines) <= max_lines:
        wanted = set(range(1, len(lines) + 1))
    # Do not present unrelated beginning-of-file code as evidence when no range matched.
    selected = sorted(sorted(wanted, key=lambda n: (n not in priority, n))[:max_lines])
    return (f"## File Path: {name}\nSelected current source lines (omitted lines are not evidence):\n" +
            "\n".join(f"{n}: {lines[n-1]}" for n in selected), set(selected))
