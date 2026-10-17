import json
from pathlib import Path

import pytest

from api.schemas import ChatCompletionRequest
from api.services import changes, document_chat
from api.services.document_context import NO_DOCUMENT, NoDocumentError, retrieve_documents, cross_check_sources
from api.utils import deepwiki_root


def save_docs(repo, title="Theme", content="Theme colors are configured here.", files=None):
    cache = Path(deepwiki_root()) / "wikicache"
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / "deepwiki_cache_local_test_repo_en.json"
    from api.services.document_store import index_documents
    pages = {"theme": {"title": title, "content": content, "filePaths": files if files is not None else ["theme.py"]}}
    index = index_documents(request(repo), pages) if content else None
    path.write_text(json.dumps({"document_index": index,"repo": {"type": "local", "repoUrl": str(repo)},
        "generated_pages": {"theme": {"title": title, "content": content,
            "filePaths": files if files is not None else ["theme.py"]}}}), encoding="utf-8")
    return path


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.setenv("DEEPWIKI_DATA_DIR", str(tmp_path / "data"))
    from api.services import document_store
    monkeypatch.setattr(document_store, "embed", lambda model, texts: [[1., 0., 0.] for _ in texts])
    root = tmp_path / "repo"
    root.mkdir()
    (root / "theme.py").write_bytes(b"color = 'red'\r\ncolor = 'red'\r\n")
    return root


def request(repo):
    return ChatCompletionRequest(repo_url=str(repo), type="local", provider="ollama",
        messages=[{"role": "user", "content": "Change theme colors to blue and green"}])


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["absent", "other_repo"])
async def test_missing_document_stops_before_source_or_model(repo, monkeypatch, state):
    if state == "empty":
        save_docs(repo, content="")
    elif state == "unrelated":
        save_docs(repo, title="Database", content="SQL transactions persist records", files=["database.py"])
    elif state == "other_repo":
        save_docs(repo.parent / "other")
    def forbidden(*args, **kwargs):
        pytest.fail("Source/model accessed before relevant documentation")
    monkeypatch.setattr(changes, "cross_check_sources", forbidden)
    monkeypatch.setattr(changes.ChatStreamer, "create", forbidden)
    for operation in (changes.propose, document_chat.document_chat):
        with pytest.raises(NoDocumentError, match=NO_DOCUMENT):
            await operation(request(repo))


def test_document_crosscheck_only_reads_referenced_current_source(repo):
    save_docs(repo, content="Theme used to be purple.")
    (repo / "unrelated.py").write_text("secret unrelated code")
    evidence = retrieve_documents(request(repo), "theme colors")
    _, sources, gaps = cross_check_sources(request(repo), evidence)
    assert list(sources) == ["theme.py"]
    assert "red" in sources["theme.py"] and not gaps


def test_ranges_disambiguate_duplicate_text_preserve_crlf_and_require_approval(repo):
    save_docs(repo)
    evidence = retrieve_documents(request(repo), "theme")
    root, sources, _ = cross_check_sources(request(repo), evidence)
    plan = changes.EditPlan(summary="Theme", edits=[
        changes.Edit(path="theme.py", start_line=1, end_line=1, new_text="color = 'blue'"),
        changes.Edit(path="theme.py", start_line=2, end_line=2, new_text="color = 'green'")])
    original = (repo / "theme.py").read_bytes()
    p = changes.make_proposal(root, plan, sources, "unused", evidence.provenance)
    assert (repo / "theme.py").read_bytes() == original
    changes.decide(p["id"], "reject")
    assert (repo / "theme.py").read_bytes() == original
    p = changes.make_proposal(root, plan, sources, "unused", evidence.provenance)
    changes.decide(p["id"], "accept")
    assert (repo / "theme.py").read_bytes() == b"color = 'blue'\r\ncolor = 'green'\r\n"


@pytest.mark.parametrize("ranges", [[(1, 2), (2, 2)], [(1, 3)]])
def test_invalid_ranges_fail_closed(repo, ranges):
    plan = changes.EditPlan(summary="invalid", edits=[changes.Edit(path="theme.py", start_line=a,
        end_line=b, new_text="blue") for a, b in ranges])
    with pytest.raises(ValueError, match="invalid or overlapping"):
        changes.resolve_line_edits(plan, {"theme.py": "red\nred\n"})


@pytest.mark.asyncio
async def test_local_invalid_plan_gets_one_corrective_attempt(repo, monkeypatch):
    save_docs(repo)
    prompts = []
    class Streamer:
        async def respond_stream(self, prompt):
            prompts.append(prompt)
            if len(prompts) == 1:
                yield "not json"
            else:
                yield json.dumps({"summary": "Blue theme", "edits": [{"path": "theme.py",
                    "start_line": 1, "end_line": 1, "new_text": "color = 'blue'"}]})
    monkeypatch.setattr(changes.ChatStreamer, "create", lambda **kw: Streamer())
    monkeypatch.setattr(changes, "get_model_config", lambda *a: {"model_kwargs": {}})
    p = await changes.propose(request(repo))
    assert len(prompts) == 2 and "validation_feedback" in prompts[1]
    assert p["documents"] and p["status"] == "pending"
    assert (repo / "theme.py").read_bytes().count(b"red") == 2


def test_legacy_proposal_cannot_be_accepted(repo):
    p = changes.make_proposal(repo.resolve(), changes.EditPlan(summary="old", edits=[
        changes.Edit(path="theme.py", start_line=1, end_line=1, new_text="blue")]),
        {"theme.py": (repo / "theme.py").read_bytes().decode()}, "unused")
    with pytest.raises(ValueError, match="lacks document-first evidence"):
        changes.decide(p["id"], "accept")
    assert changes.decide(p["id"], "reject")["status"] == "rejected"


def test_http_and_websocket_missing_documents(repo):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers.chat import router
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        payload = request(repo).model_dump()
        response = client.post("/chat/completions/stream", json=payload)
        assert response.status_code == 200 and response.text == NO_DOCUMENT
        with client.websocket_connect("/ws/chat") as ws:
            ws.send_json(payload)
            assert ws.receive_text() == NO_DOCUMENT


@pytest.mark.asyncio
async def test_codemap_missing_documents_does_not_infer(repo, monkeypatch):
    from api.schemas import CodeMapRequest
    from api.services import codemap
    def forbidden(*args, **kwargs):
        pytest.fail("Must stop before source/model")
    monkeypatch.setattr(codemap, "cross_check_sources", forbidden)
    monkeypatch.setattr(codemap.ChatStreamer, "create", forbidden)
    events = [json.loads(e) async for e in codemap.generate_codemap(
        CodeMapRequest(repo_url=str(repo), type="local", question="Theme colors"))]
    assert events[-1] == {"type": "error", "message": NO_DOCUMENT}


@pytest.mark.asyncio
async def test_document_answer_contains_docs_without_current_source(repo, monkeypatch):
    save_docs(repo, content="Theme documentation says purple; compare with current code.")
    captured = []
    class Streamer:
        async def respond_stream(self, prompt):
            captured.append(prompt)
            yield '{"relevant":true,"grounded":true}' if "candidate_answer" in prompt else "Current colors are red. `theme.py:1`"
    monkeypatch.setattr(document_chat.ChatStreamer, "create", lambda **kw: Streamer())
    monkeypatch.setattr(document_chat, "get_model_config", lambda *a: {"model_kwargs": {}})
    stream = await document_chat.document_chat(request(repo))
    assert "red" in "".join([part async for part in stream])
    assert "purple" in captured[0] and "1: color = 'red'" not in captured[0]
    assert len(captured) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("provider, expected", [("ollama", 2), ("openai", 1)])
async def test_invalid_model_output_retry_limit_and_no_writes(repo, monkeypatch, provider, expected):
    save_docs(repo)
    calls = []
    class Streamer:
        async def respond_stream(self, prompt):
            calls.append(prompt)
            yield "invalid"
    monkeypatch.setattr(changes.ChatStreamer, "create", lambda **kw: Streamer())
    monkeypatch.setattr(changes, "get_model_config", lambda *a: {"model_kwargs": {}})
    payload = request(repo).model_copy(update={"provider": provider})
    original = (repo / "theme.py").read_bytes()
    with pytest.raises(ValueError, match="No changes applied"):
        await changes.propose(payload)
    assert len(calls) == expected
    assert (repo / "theme.py").read_bytes() == original
    assert not (Path(deepwiki_root()) / "changes.sqlite3").exists()
