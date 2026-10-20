import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api.services import changes
from api.schemas import ChatCompletionRequest


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.setenv("DEEPWIKI_DATA_DIR", str(tmp_path / "data"))
    root = tmp_path / "repo"
    root.mkdir()
    (root / "main.py").write_bytes(b"value = 1\r\n")
    return root


def proposal(repo, edits=None):
    return changes.make_proposal(repo.resolve(), changes.EditPlan(summary="Change value", edits=edits or [
        changes.Edit(path="main.py", old_text="value = 1", new_text="value = 2")
    ]), {"main.py": "value = 1\r\n"}, str(repo.parent / "data" / "cache.pkl"), [{"page_id": "overview", "title": "Overview", "chunk": 1, "files": ["main.py"]}])


def test_generate_reject_and_repeated_accept_never_write(repo):
    p = proposal(repo)
    assert (repo / "main.py").read_bytes() == b"value = 1\r\n"
    assert "-value = 1" in p["files"][0]["diff"]
    assert changes.decide(p["id"], "reject")["status"] == "rejected"
    assert changes.decide(p["id"], "accept")["status"] == "rejected"
    assert (repo / "main.py").read_bytes() == b"value = 1\r\n"


def test_accept_persists_exact_review_and_invalidates_cache(repo):
    cache = repo.parent / "data" / "cache.pkl"
    p = proposal(repo)
    cache.write_bytes(b"old index")
    assert changes.get_proposal(p["id"]) == p
    assert changes.decide(p["id"], "accept")["status"] == "accepted"
    assert (repo / "main.py").read_bytes() == b"value = 2\r\n"
    assert not cache.exists()
    assert changes.decide(p["id"], "accept")["status"] == "accepted"


def test_conflict_blocks_entire_batch(repo):
    p = proposal(repo, [changes.Edit(path="new.py", action="create", new_text="new"),
        changes.Edit(path="main.py", old_text="value = 1", new_text="value = 2")])
    (repo / "main.py").write_text("user changes")
    with pytest.raises(ValueError, match="changed since review"):
        changes.decide(p["id"], "accept")
    assert not (repo / "new.py").exists()
    assert (repo / "main.py").read_text() == "user changes"
    assert changes.get_proposal(p["id"])["status"] == "pending"


def test_create_delete_only_on_accept(repo):
    p = proposal(repo, [changes.Edit(path="new/file.py", action="create", new_text="new\n"),
        changes.Edit(path="main.py", action="delete", old_text="value = 1\r\n")])
    assert not (repo / "new").exists()
    changes.decide(p["id"], "accept")
    assert (repo / "new/file.py").read_text() == "new\n"
    assert not (repo / "main.py").exists()


@pytest.mark.parametrize("name", ["../escape", "/absolute", ".git/config", "dir/.GIT/config", "C:/file", "a:stream", "a\\file", "NUL.txt", "file.", "./main.py", "a//b"])
def test_invalid_paths(repo, name):
    with pytest.raises(ValueError):
        proposal(repo, [changes.Edit(path=name, action="create", new_text="bad")])


def test_not_retrieved_or_ambiguous_edits_rejected(repo):
    (repo / "hidden.py").write_text("private")
    with pytest.raises(ValueError, match="grounded"):
        proposal(repo, [changes.Edit(path="hidden.py", old_text="private", new_text="bad")])
    with pytest.raises(ValueError, match="matched 0"):
        proposal(repo, [changes.Edit(path="main.py", old_text="missing", new_text="bad")])


def test_failed_second_write_rolls_back_first(repo, monkeypatch):
    p = proposal(repo, [changes.Edit(path="main.py", old_text="value = 1", new_text="value = 2"),
        changes.Edit(path="new.py", action="create", new_text="new")])
    real_write = changes.write_source
    def fail_new(path, text):
        if path.name == "new.py":
            raise OSError("write failed")
        real_write(path, text)
    monkeypatch.setattr(changes, "write_source", fail_new)
    with pytest.raises(OSError):
        changes.decide(p["id"], "accept")
    assert (repo / "main.py").read_bytes() == b"value = 1\r\n"


@pytest.mark.asyncio
async def test_retrieval_generation_proposes_without_writing(repo, monkeypatch):
    seen = {}
    from api.services import document_store
    monkeypatch.setattr(document_store, "embed", lambda model, texts: [[1., 0., 0.] for _ in texts])
    from tests.test_document_first import save_docs
    save_docs(repo, title="Default value", content="The default value is configured in main.py.", files=["main.py"])
    class Streamer:
        async def respond_stream(self, prompt):
            if 'Locate the current code blocks' in prompt:
                source = 'theme.py' if (repo / 'theme.py').exists() else 'main.py'
                yield json.dumps({'blocks': [{'path': source, 'snippet': (repo / source).read_text()}]})
                return
            seen["prompt"] = prompt
            yield json.dumps({"summary": "Change value", "edits": [{"path": "main.py", "start_line": 1, "end_line": 1, "new_text": "value = 2"}]})
    monkeypatch.setattr(changes.ChatStreamer, "create", lambda **kw: Streamer())
    monkeypatch.setattr(changes, "get_model_config", lambda *a: {"model_kwargs": {}})
    p = await changes.propose(ChatCompletionRequest(repo_url=str(repo), type="local", messages=[
        {"role": "user", "content": "Change value to 2"}]))
    assert p["status"] == "pending"
    assert "main.py" in seen["prompt"] and "value = 1" in seen["prompt"]
    assert "Generated document: Default value" in seen["prompt"]
    assert (repo / "main.py").read_bytes() == b"value = 1\r\n"


def test_review_api_requires_local_review_header(repo):
    from fastapi import FastAPI
    from api.routers.changes import router
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    p = proposal(repo)
    url = f"/chat/changes/{p['id']}/accept"
    assert client.post(url).status_code == 403
    assert client.post(url, headers={"x-deepwiki-review": "1", "origin": "https://evil.example"}).status_code == 403
    assert client.post(url, headers={"x-deepwiki-review": "1", "origin": "http://127.0.0.1:3000"}).status_code == 200
