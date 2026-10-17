"""Exercise the native DeepWiki pipeline against a deterministic Ollama HTTP fixture.

No model download, paid provider request, or real inference is performed.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


@pytest.fixture
def ollama_server(monkeypatch):
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send_json(self, payload):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode() + b"\n")

        def do_GET(self):
            self.send_json({"models": [{"model": "nomic-embed-text:latest"}]})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((self.path, body))
            if self.path == "/api/embed":
                texts = body["input"]
                if isinstance(texts, str):
                    texts = [texts]
                self.send_json({"model": body["model"], "embeddings": [[1., 0., 0., 0.] for _ in texts]})
            elif self.path == "/api/chat":
                content = "The input is read by load_input in source.py."
                if "repository coding assistant preparing changes" in body["messages"][0]["content"]:
                    content = json.dumps({"summary": "Use UTF-8 when reading input.", "edits": [{
                        "path": "source.py", "start_line": 2, "end_line": 2, "new_text": "    return open(path, encoding='utf-8').read()"}]})
                self.send_json({"model": body["model"], "message": {
                    "role": "assistant", "content": content}, "done": True})
            else:
                self.send_error(404)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("OLLAMA_HOST", f"http://127.0.0.1:{server.server_port}")
    yield calls
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.mark.asyncio
async def test_native_index_retrieve_augment_generate(ollama_server, monkeypatch, tmp_path, exclude_test_config):
    from api.config import configs
    from api.rag.rag import RAG, check_ollama_model_exists
    from api.schemas import ChatCompletionRequest
    from api.services.research import research_chat

    monkeypatch.setenv("DEEPWIKI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setitem(configs["retriever"], "top_k", 1)
    source = tmp_path / "repo"
    source.mkdir()
    (source / "source.py").write_text('def load_input(path):\n    """Read the application input file."""\n    return open(path).read()\n')
    assert check_ollama_model_exists("nomic-embed-text")
    assert check_ollama_model_exists("nomic-embed-text:latest")
    assert not check_ollama_model_exists("nomic-embed-text:missing")

    rag = RAG(provider="ollama", model="qwen3:8b")
    await rag.aprepare_retriever(str(source), "local")
    matches = await rag.acall("What are the input sources?")
    assert "load_input" in matches[0].documents[0].text
    assert matches[0].documents[0].meta_data["start_line"] == 1
    assert list((tmp_path / "data").rglob("*.pkl"))

    request = ChatCompletionRequest(repo_url=str(source), type="local", provider="ollama", model="qwen3:8b",
        messages=[{"role": "user", "content": "What are the input sources?"}])
    stream = await research_chat(request)
    answer = "".join([part async for part in stream])
    assert "load_input" in answer
    prompts = [body["messages"][0]["content"] for path, body in ollama_server if path == "/api/chat"]
    assert prompts and "source.py" in prompts[-1] and "def load_input" in prompts[-1]
    assert "[lines 1-" in prompts[-1]


@pytest.mark.asyncio
async def test_native_retrieval_to_review_to_accept(ollama_server, monkeypatch, tmp_path, exclude_test_config):
    from api.config import configs
    from api.schemas import ChatCompletionRequest
    from api.services.changes import propose, decide
    monkeypatch.setenv("DEEPWIKI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setitem(configs["retriever"], "top_k", 1)
    source = tmp_path / "repo"
    source.mkdir()
    path = source / "source.py"
    original = b"def load_input(path):\n    return open(path).read()\n"
    path.write_bytes(original)
    from tests.test_document_first import save_docs
    save_docs(source, title="Input loading", content="Read input files using the load_input function in source.py.", files=["source.py"])
    request = ChatCompletionRequest(repo_url=str(source), type="local", provider="ollama", model="qwen3:8b",
        messages=[{"role": "user", "content": "Read input using UTF-8"}])
    proposal = await propose(request)
    assert path.read_bytes() == original
    assert "encoding='utf-8'" in proposal["files"][0]["diff"]
    assert proposal["documents"][0]["title"] == "Input loading"
    embedded = [text for url, body in ollama_server if url == "/api/embed" for text in body["input"]]
    assert any("Read input files" in text for text in embedded)
    assert not any("def load_input" in text for text in embedded), "Only documents and queries may be embedded"
    decide(proposal["id"], "accept")
    assert b"encoding='utf-8'" in path.read_bytes()
    assert not list((tmp_path / "data").rglob("*.pkl"))


def test_local_defaults_and_timeout(monkeypatch):
    from api.clients.ollama import OllamaClient
    from api.config import configs, get_embedder_type
    from api.schemas.base import RepoRequestBase
    assert configs["default_provider"] == "ollama"
    assert get_embedder_type() == "ollama"
    assert RepoRequestBase(repo_url="example").provider == "ollama"
    monkeypatch.setenv("OLLAMA_TIMEOUT_SECONDS", "1200")
    client = OllamaClient(host="http://127.0.0.1:11434")
    assert client.sync_client._client.timeout.read == 1200
    assert client.async_client._client.timeout.connect == 10


def test_native_api_configuration():
    from fastapi.testclient import TestClient
    from api.main import app
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "healthy"
        config = client.get("/models/config").json()
        assert config["defaultProvider"] == "ollama"
        local = next(p for p in config["providers"] if p["id"] == "ollama")
        assert local["models"][0]["id"] == "qwen3:8b"
