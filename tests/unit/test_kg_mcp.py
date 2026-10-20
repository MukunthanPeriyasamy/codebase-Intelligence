import json
import sys

import pytest
from jsonschema.exceptions import ValidationError

from api.services.kg_mcp import GraphMCP


@pytest.fixture
def server(tmp_path, monkeypatch):
    fake = tmp_path / 'server.py'
    fake.write_text('''import sys, json
tools = [{"name":"find_code","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}},
         {"name":"delete_repository","inputSchema":{"type":"object"}}]
for line in sys.stdin:
    r=json.loads(line)
    if 'id' not in r: continue
    method=r['method']
    result = {'tools':tools} if method=='tools/list' else {'content':[{'type':'text','text':json.dumps(r.get('params',{}))}]} if method=='tools/call' else {'protocolVersion':'2025-03-26'}
    print(json.dumps({'jsonrpc':'2.0','id':r['id'],'result':result}), flush=True)
''')
    config = tmp_path / 'mcp.json'
    config.write_text(json.dumps({'command': sys.executable, 'args': [str(fake)], 'cwd': str(tmp_path)}))
    monkeypatch.setenv('DEEPWIKI_KG_CONFIG', str(config))
    client = GraphMCP()
    yield client
    client.close()


def test_discovery_call_and_persistent_process(server):
    catalog = server.catalog()
    pid = server.process.pid
    assert len(catalog['tools']) == 2
    assert not catalog['tools'][0]['requires_confirmation']
    assert catalog['tools'][1]['requires_confirmation']
    result = server.call('find_code', {'query': 'hello'})
    assert 'hello' in result['content'][0]['text']
    assert server.process.pid == pid


def test_validation_and_confirmation(server):
    with pytest.raises(ValueError, match='Confirm'):
        server.call('delete_repository', {})
    with pytest.raises(ValidationError):
        server.call('find_code', {'query': 123})
    with pytest.raises(ValueError, match='Unknown'):
        server.call('invented_tool', {})


def test_windows_path_normalization(server):
    result = server.call('find_code', {'query': 'hello', 'repo_path': r'D:\project\repo'})
    assert json.loads(result['content'][0]['text'])['arguments']['repo_path'] == 'D:/project/repo'


def test_missing_config(monkeypatch, tmp_path):
    monkeypatch.setenv('DEEPWIKI_KG_CONFIG', str(tmp_path / 'missing.json'))
    with pytest.raises(RuntimeError, match='DEEPWIKI_KG_CONFIG file does not exist'):
        GraphMCP().catalog()
