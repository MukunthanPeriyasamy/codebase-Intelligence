from fastapi.testclient import TestClient
from api.main import app


def test_versioned_routes_and_legacy_compatibility(monkeypatch):
    from api.services import document_store
    class Store:
        def heartbeat(self): return 1
    monkeypatch.setattr(document_store, 'client', lambda: Store())
    with TestClient(app) as client:
        assert client.get('/api/v1/auth/status').json() == client.get('/auth/status').json()
        assert client.get('/api/v1/ready').json()['vector_store'] == 'ready'
        services = client.get('/api/v1/agents').json()['services']
        assert services['changes']['requires_user_approval'] is True
        assert client.post('/api/v1/chat/changes',json={}).status_code == 403
        assert client.post('/api/v1/wiki/tasks',json={}).status_code == 422
        assert client.post('/api/v1/documents/retrieve',json={}).status_code == 422
        with client.websocket_connect('/api/v1/ws/chat') as ws:
            ws.send_json({'repo_url':'https://github.com/example/never-indexed','messages':[]})
            assert ws.receive_text() == 'Error: No messages provided'


def test_readiness_reports_storage_failure(monkeypatch):
    from api.services import document_store
    def unavailable(): raise ImportError('chromadb')
    monkeypatch.setattr(document_store,'client', unavailable)
    with TestClient(app) as client:
        result = client.get('/api/v1/ready')
        assert result.status_code == 503
        assert result.json()['status'] == 'unavailable'
