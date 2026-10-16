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
from urllib.parse import urlsplit, unquote

from api.repository import Repo
from api.schemas.base import RepoRequestBase
from api.services.source_files import safe_path, read_source
from api.utils import deepwiki_root
from api.services.document_schema import build_schema, route_schema

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
                               chunk=start // 1600 + 1, files=files, areas=entry["areas"]))
    query_terms = set(terms(query))
    if query_terms & {"theme", "color", "colour", "colors", "colours", "palette", "styling"}:
        query_terms.update({"theme", "color", "colors", "colour", "palette", "styling", "appearance"})
    tokens = [Counter(terms(c["text"] + " " + c["title"] + " " + " ".join(c["files"]))) for c in chunks]
    df = Counter(t for bag in tokens for t in bag)
    ranked = []
    for chunk, bag in zip(chunks, tokens):
        score = sum(math.log(1 + len(chunks) / df[t]) * (1 + math.log(bag[t]))
                    for t in query_terms if bag[t])
        score += 2 * len(set(terms(chunk["title"])) & query_terms)
        if score > 0:
            if chunk["page_id"] in routed_pages:
                score *= 1.5
            ranked.append((score, chunk))
    if not ranked:
        raise NoDocumentError()
    # Search the selected schema branches and their documented connections
    # first. If none match, widen only within the document index.
    scoped = [(score, chunk) for score, chunk in ranked if chunk["page_id"] in routed_pages | connected_pages]
    if scoped:
        ranked = scoped
    ranked.sort(key=lambda item: item[0], reverse=True)
    selected, per_file = [], Counter()
    for _, chunk in ranked:
        primary = chunk["files"][0] if chunk["files"] else chunk["page_id"]
        if per_file[primary] >= 2:
            continue
        selected.append(chunk)
        per_file[primary] += 1
        if len(selected) == 6:
            break
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
