import json

import pytest

from api.schemas import ChatCompletionRequest, WikiStructureModel, WikiTaskRequest
from api.services.wiki.reference import build_reference_pages, attach_reference_pages
from api.services.wiki.tasks import WikiTask, _generate_page
from api.services.document_context import retrieve_legacy_documents as retrieve_documents, cross_check_sources
from api.utils import deepwiki_root
from pathlib import Path


@pytest.fixture
def repository(tmp_path):
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend/ocr_pipeline.py").write_text('''from pathlib import Path

async def extract(value: str, limit: int = 5) -> str:
    """Extract OCR text from a value."""
    try:
        result = value[:limit]
        return result
    except ValueError as error:
        raise RuntimeError("OCR failed") from error
    else:
        return "empty"
    finally:
        print("cleanup")

class Runner:
    def run(self, value):
        def normalize(text):
            return text.strip()
        transform = lambda text: text.lower()
        return normalize(transform(value))
''', encoding="utf-8")
    (tmp_path / "backend/app.py").write_text('''from .ocr_pipeline import extract as read_ocr

async def handle(payload):
    output = await read_ocr(payload, limit=12)
    return output
''', encoding="utf-8")
    (tmp_path / "widget.ts").write_text("export function visible(value: string) { return value; }\n", encoding="utf-8")
    (tmp_path / "widget.custom").write_text("export function visible(value: string) { return value; }\n", encoding="utf-8")
    return tmp_path


def test_all_python_functions_contracts_connections_and_source(repository):
    pages = build_reference_pages(repository, ["backend/ocr_pipeline.py", "backend/app.py", "widget.ts"])
    functions = [p for p in pages if p.content.startswith("# Function")]
    assert len(functions) == 6  # Python definitions plus TypeScript visible
    extraction = next(p for p in functions if " · extract · " in p.title)
    assert "value: str, limit: int=5" in extraction.content
    for text in ["return result", "RuntimeError", "finally lines", "read_ocr(payload, limit=12)", "output = await", "## Imports"]:
        assert text in extraction.content
    assert extraction.filePaths == ["backend/ocr_pipeline.py", "backend/app.py"]
    assert "5:     try:" in extraction.content
    assert "Domain layer" in pages[0].content and "Business layer" in pages[0].content
    assert "Data layer" in pages[0].content and "Application layer" in pages[0].content
    assert "syntax-derived" in pages[0].content
    assert next(p for p in pages if p.title.startswith("widget.ts")).referenceKind == "static"


def test_long_functions_and_module_code_are_not_truncated(repository):
    source = "def long_function():\n" + "    value = 1\n" * 220 + "    return value\n"
    (repository / "long.py").write_text(source)
    pages = build_reference_pages(repository, ["long.py"])
    assert any("222:     return value" in p.content for p in pages if p.title.startswith("long.py · long_function"))
    file_pages = [p for p in pages if " · source L" in p.title]
    assert len(file_pages) == 3
    assert "222:     return value" in file_pages[-1].content


def test_parse_failures_missing_and_unsafe_files_are_reported(repository):
    (repository / "broken.py").write_text("def broken(:\n")
    pages = build_reference_pages(repository, ["broken.py", "missing.py", "../escape.py"])
    assert "parse failed" in pages[0].content
    assert "missing.py" in pages[0].content and "skipped" in pages[0].content
    assert "Invalid repository-relative path" in pages[0].content
    assert any("def broken(" in p.content for p in pages[1:])


def test_reference_docs_retrieve_ocr_and_its_caller_before_source(repository, monkeypatch):
    monkeypatch.setenv("DEEPWIKI_DATA_DIR", str(repository / "data"))
    pages = build_reference_pages(repository, ["backend/ocr_pipeline.py", "backend/app.py"])
    cache = Path(deepwiki_root()) / "wikicache"
    cache.mkdir()
    (cache / "deepwiki_cache_local_test_repo_en.json").write_text(json.dumps({
        "repo": {"type": "local", "repoUrl": str(repository)},
        "generated_pages": {p.id: p.model_dump() for p in pages}}))
    request = ChatCompletionRequest(repo_url=str(repository), type="local", messages=[{"role": "user", "content": "remove OCR pipeline completely"}])
    evidence = retrieve_documents(request, request.messages[0].content)
    _, sources, _ = cross_check_sources(request, evidence)
    assert "backend/ocr_pipeline.py" in sources
    assert "backend/app.py" in sources


@pytest.mark.asyncio
async def test_static_reference_does_not_need_model_and_overview_stays_visible(repository, monkeypatch):
    from api.services.wiki import tasks
    pages = build_reference_pages(repository, ["backend/ocr_pipeline.py"])
    def forbidden(*args, **kwargs):
        pytest.fail("Static facts must not depend on inference")
    monkeypatch.setattr(tasks.ChatStreamer, "create", forbidden)
    task = WikiTask.from_wiki_request(WikiTaskRequest(owner="test", repo="repo", type="local", repo_url=str(repository)))
    assert await _generate_page(task, pages[1]) == pages[1]
    structure = WikiStructureModel(id="wiki", title="Wiki", description="", pages=[])
    attach_reference_pages(structure, pages)
    assert structure.rootSections == ["overview-pages", "source-reference"]
    assert all(not p.content for p in structure.pages)
    task.reference_pages = {p.id: p for p in pages}
    restored = await _generate_page(task, structure.pages[1])
    assert restored.content == pages[1].content
    assert "reference_pages" not in task.model_dump()
    assert all(not p.content for p in structure.pages)
    task.reference_pages = {p.id: p for p in pages}
    restored = await _generate_page(task, structure.pages[1])
    assert restored.content == pages[1].content
    assert "reference_pages" not in task.model_dump()


@pytest.mark.asyncio
async def test_other_language_uses_full_numbered_slice_without_rag(repository, monkeypatch):
    from api.services.wiki import tasks
    pages = build_reference_pages(repository, ["widget.custom"])
    page = next(p for p in pages if p.referenceKind == "source")
    prompts = []
    class Streamer:
        async def respond_stream(self, prompt):
            prompts.append(prompt)
            yield "visible receives a string and returns that same value."
    monkeypatch.setattr(tasks.ChatStreamer, "create", lambda **kw: Streamer())
    monkeypatch.setattr(tasks, "get_model_config", lambda *a: {"model_kwargs": {}})
    def forbidden(*args, **kwargs):
        pytest.fail("Reference generation must not replace source slices with RAG")
    monkeypatch.setattr(tasks, "research_chat", forbidden)
    task = WikiTask.from_wiki_request(WikiTaskRequest(owner="test", repo="repo", type="local", repo_url=str(repository)))
    generated = await _generate_page(task, page)
    assert "1: export function visible" in prompts[0]
    assert page.content in generated.content
    assert "returns that same value" in generated.content


@pytest.mark.asyncio
async def test_analysis_failure_keeps_numbered_evidence(repository, monkeypatch):
    from api.services.wiki import tasks
    page = next(p for p in build_reference_pages(repository, ["widget.custom"]) if p.referenceKind == "source")
    async def fail(*args):
        raise ValueError("fixture model unavailable")
    monkeypatch.setattr(tasks, "_generate_page", fail)
    monkeypatch.setattr(tasks, "WIKI_PAGE_RETRIES", 0)
    task = WikiTask.from_wiki_request(WikiTaskRequest(owner="test", repo="repo", type="local", repo_url=str(repository)))
    generated = await tasks._generate_page_with_retry(task, page)
    assert "1: export function visible" in generated.content
    assert "Analysis incomplete" in generated.content


def test_class_importers_are_in_file_provenance(repository):
    (repository / "entry.py").write_text("from backend.ocr_pipeline import Runner\ninstance = Runner()\n")
    pages = build_reference_pages(repository, ["backend/ocr_pipeline.py", "entry.py"])
    target = next(p for p in pages if " · Runner.run · " in p.title)
    assert "entry.py" in target.filePaths


def test_final_code_snippet_keeps_its_closing_fence():
    from api.services.wiki.tasks import _strip_markdown_fences
    text = "# Function\n\n```python\nreturn value\n```"
    assert _strip_markdown_fences(text) == text
