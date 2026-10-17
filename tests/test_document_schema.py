import json
from pathlib import Path

import pytest

from api.schemas import ChatCompletionRequest, WikiCacheData, WikiPage, WikiStructureModel
from api.services.document_schema import build_schema, route_schema
from api.services.document_context import retrieve_legacy_documents as retrieve_documents
from api.utils import deepwiki_root


def page(title, path, content):
    return {"id": title, "title": title, "content": content, "filePaths": [path], "importance": "high", "relatedPages": []}


def test_schema_categories_and_chunk_source_ranges():
    pages = {
        "ui": page("Theme", "frontend/theme.tsx", "Source: `frontend/theme.tsx:5-12`\nTheme color settings"),
        "api": page("Routes", "backend/api/routes.go", "HTTP endpoints and load function"),
        "db": page("Tables", "database/schema.sql", "CREATE TABLE users"),
    }
    schema = build_schema(pages)
    assert schema["areas"]["frontend"] == ["ui"]
    assert schema["areas"]["api"] == ["api"]
    assert schema["areas"]["databases"] == ["db"]
    assert schema["pages"]["ui"]["source_ranges"] == [{"file": "frontend/theme.tsx", "start_line": 5, "end_line": 12}]
    assert schema["pages"]["ui"]["chunks"][0]["start"] == 0
    assert route_schema(schema, "change frontend theme")[1] == {"ui"}


def test_schema_routes_documents_before_any_source_lookup(tmp_path, monkeypatch):
    monkeypatch.setenv("DEEPWIKI_DATA_DIR", str(tmp_path / "data"))
    # Repository does not exist: retrieval/schema creation cannot depend on code.
    repo = str(tmp_path / "missing-code")
    pages = {
        "ui": page("Load function", "frontend/load.ts", "load returns a visible UI value"),
        "backend": page("Load function", "backend/load.go", "load returns a server value " * 30),
    }
    cache = Path(deepwiki_root()) / "wikicache"
    cache.mkdir()
    (cache / "deepwiki_cache_local_test_repo_en.json").write_text(json.dumps({
        "repo": {"type": "local", "repoUrl": repo}, "generated_pages": pages}))
    request = ChatCompletionRequest(repo_url=repo, type="local", messages=[{"role": "user", "content": "frontend load"}])
    evidence = retrieve_documents(request, "frontend load")
    assert {c["page_id"] for c in evidence.chunks} == {"ui"}
    assert evidence.provenance[0]["areas"] == ["frontend"]
    assert "schema areas: frontend" in evidence.context


def test_schema_retains_documented_cross_area_connections():
    ui = page("Frontend fetch", "frontend/view.tsx", "fetch from the API")
    ui["filePaths"].append("backend/api.go")
    schema = build_schema({"ui": ui, "api": page("API handler", "backend/api.go", "handle fetch")})
    assert schema["pages"]["ui"]["files"] == ["frontend/view.tsx", "backend/api.go"]
    assert "api" in schema["areas"]


@pytest.mark.asyncio
async def test_cache_save_persists_schema_without_source_reads(tmp_path, monkeypatch):
    from api.services.wiki import io
    monkeypatch.setattr(io, "WIKI_CACHE_DIR", str(tmp_path))
    item = WikiPage(**page("API", "api/router.cs", "API router contract"))
    cache = WikiCacheData(wiki_structure=WikiStructureModel(id="wiki", title="Wiki", description="", pages=[item]), generated_pages={item.id: item})
    assert await io.save_wiki_cache("owner", "repo", "local", "en", cache)
    data = json.loads((tmp_path / "deepwiki_cache_local_owner_repo_en.json").read_text())
    assert data["documentation_schema"]["areas"]["api"] == ["API"]
