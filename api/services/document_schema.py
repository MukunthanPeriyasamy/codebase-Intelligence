"""Build and route a document-only schema. No repository reads or inference."""
import re
from pathlib import PurePosixPath
from api.services.developer_intent import CONCEPTS

AREAS = {
    "frontend": {"frontend", "ui", "ux", "component", "components", "screen", "screens", "theme", "color", "colour", "palette", "css", "styles", "styling", "layout", "button", "react", "vue", "svelte"},
    "backend": {"backend", "server", "service", "services", "worker", "workers", "pipeline", "agents", "jobs"},
    "databases": {"database", "databases", "db", "sql", "schema", "migration", "migrations", "repository", "repositories", "persistence", "storage", "query", "table"},
    "api": {"api", "apis", "endpoint", "endpoints", "route", "routes", "router", "routers", "controller", "controllers", "http", "rest", "graphql"},
    "domain": {"domain", "entity", "entities", "valueobject", "valueobjects"},
    "business": {"business", "usecase", "usecases", "policy", "policies", "validation", "rules"},
    "application": {"application", "bootstrap", "main", "startup", "orchestration"},
    "configuration": {"config", "configuration", "settings", "deployment", "docker", "ci", "build"},
    "tests": {"test", "tests", "testing", "spec", "specs", "fixture", "fixtures"},
}


def tokens(value):
    value = re.sub(r"([a-z])([A-Z])", r"\1 \2", value)
    return set(re.findall(r"[^\W_]+", value.lower()))


def categories(title, paths):
    # Primary implementation file determines area, not unrelated caller paths.
    primary = paths[0] if paths else ""
    words = tokens(title + " " + primary)
    result = [area for area, aliases in AREAS.items() if words & aliases]
    if PurePosixPath(primary).suffix.lower() in {".jsx", ".tsx", ".html", ".css", ".scss", ".vue", ".svelte"}:
        result.append("frontend")
    if PurePosixPath(primary).suffix.lower() == ".sql":
        result.append("databases")
    return sorted(set(result)) or ["general"]


def build_schema(pages):
    index = {area: [] for area in [*AREAS, "general"]}
    entries = {}
    for page_id, value in pages.items():
        page = value.model_dump() if hasattr(value, "model_dump") else value
        if not isinstance(page, dict) or not isinstance(page.get("content"), str) or not page["content"].strip():
            continue
        paths = page.get("filePaths") or []
        paths = [p.replace("\\", "/").removeprefix("./") for p in paths if isinstance(p, str)] if isinstance(paths, list) else []
        title = str(page.get("title", page_id))
        areas = categories(title, paths)
        content = page["content"]
        chunks = [{"id": f"{page_id}:{offset // 1600 + 1}", "start": offset, "end": min(offset + 2000, len(content))}
                  for offset in range(0, len(content), 1600)]
        ranges = [{"file": path, "start_line": int(start), "end_line": int(end or start)}
                  for path, start, end in re.findall(r"`([^`\n]+?):(\d+)(?:-(\d+))?`", content)
                  if path in paths]
        concepts = [name for name, aliases in CONCEPTS.items()
                    if len(tokens(title + " " + content) & tokens(aliases)) >= 2]
        entries[page_id] = {"title": title, "areas": areas, "concepts": concepts,
                            "files": paths, "source_ranges": ranges, "chunks": chunks}
        for area in areas:
            index[area].append(page_id)
    return {"version": 1, "areas": index, "pages": entries}


def route_schema(schema, query):
    words = tokens(query)
    areas = [area for area, aliases in AREAS.items() if words & aliases]
    selected = {page for area in areas for page in schema["areas"].get(area, [])}
    # General requests or missing classifications search the documentation index,
    # never the source tree. Area hints affect ranking, not evidence availability.
    return areas, selected
