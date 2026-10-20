from types import SimpleNamespace
import pytest
from api.services.wiki import graph_build


@pytest.mark.asyncio
async def test_nested_job_status(tmp_path, monkeypatch):
    task = SimpleNamespace(pipeline=[{'id': 'kg', 'state': 'pending'}])
    calls = []
    def call(name, arguments, **kwargs):
        calls.append((name, arguments, kwargs))
        return {'structuredContent': {'job_id': 'test'} if name == 'add_code_to_graph' else {'job': {'status': 'completed'}}}
    monkeypatch.setattr(graph_build.graph, 'call', call)
    monkeypatch.setattr(graph_build.graph, 'catalog', lambda: {})
    await graph_build.build_graph(task, tmp_path)
    assert task.pipeline[0]['state'] == 'completed'
    assert calls[0][1]['repo_path'] == tmp_path.as_posix()
    assert calls[0][2]['confirmed'] is True


@pytest.mark.asyncio
async def test_failure_is_visible(tmp_path, monkeypatch):
    task = SimpleNamespace(pipeline=[{'id': 'kg', 'state': 'pending'}])
    monkeypatch.setattr(graph_build.graph, 'call', lambda *a, **kw: {'isError': True})
    monkeypatch.setattr(graph_build.graph, 'catalog', lambda: {})
    await graph_build.build_graph(task, tmp_path)
    assert task.pipeline[0]['state'] == 'failed'
    assert 'independent' in task.pipeline[0]['detail']
