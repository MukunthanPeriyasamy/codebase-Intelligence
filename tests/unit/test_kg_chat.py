import json
import sys
from types import SimpleNamespace

import pytest

from api.services import kg_chat


def fake_model(monkeypatch, outputs):
    class Streamer:
        @classmethod
        def create(cls, **kwargs):
            return cls()

        async def respond_stream(self, prompt):
            yield outputs.pop(0)

    monkeypatch.setitem(sys.modules, 'api.chat', SimpleNamespace(ChatStreamer=Streamer))
    monkeypatch.setitem(sys.modules, 'api.config', SimpleNamespace(get_model_config=lambda *a: {'model_kwargs': {}}))


@pytest.mark.asyncio
async def test_model_cannot_execute_mutations(monkeypatch):
    fake_model(monkeypatch, [json.dumps({'calls': [{'name': 'delete_repository', 'arguments': {}}]})])
    monkeypatch.setattr(kg_chat.graph, 'catalog', lambda: {'workspace': 'D:/repo', 'tools': []})
    def forbidden(*args):
        pytest.fail('Mutating tool must never execute')
    monkeypatch.setattr(kg_chat.graph, 'call', forbidden)
    with pytest.raises(ValueError, match='unsupported'):
        await kg_chat.answer('delete repository', 'ollama', 'test')


@pytest.mark.asyncio
async def test_scope_and_evidence(monkeypatch):
    fake_model(monkeypatch, [json.dumps({'calls': [{'name': 'find_code', 'arguments': {'query': 'run', 'repo_path': 'wrong'}}]}), 'run calls greet [find_code]'])
    monkeypatch.setattr(kg_chat.graph, 'catalog', lambda: {'workspace': 'D:/repo', 'tools': [
        {'name': 'find_code', 'inputSchema': {'properties': {'repo_path': {}}}}]})
    def call(name, args):
        assert args['repo_path'] == 'D:/repo'
        return {'content': [{'type': 'text', 'text': 'run calls greet'}]}
    monkeypatch.setattr(kg_chat.graph, 'call', call)
    result = await kg_chat.answer('who calls greet?', 'ollama', 'test')
    assert result['evidence'][0]['tool'] == 'find_code'
    assert 'run calls greet' in result['answer']
