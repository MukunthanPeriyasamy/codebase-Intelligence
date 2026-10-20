import json
from api.services import edit_graph
from api.services.document_context import DocumentEvidence


def evidence():
    return DocumentEvidence([{'file_records': [{'path': 'main.py', 'symbols': [{'name': 'run'}]}]}])


def test_graph_expansion_is_scoped_and_reads_live_source(tmp_path, monkeypatch):
    (tmp_path / 'main.py').write_text('def run(): pass')
    (tmp_path / 'caller.py').write_text('run()')
    calls = []
    monkeypatch.setattr(edit_graph.graph, 'catalog', lambda: {'tools': [{'name': 'analyze_code_relationships', 'inputSchema': {'properties': {'repo_path': {}}}}]})
    def call(name, arguments):
        calls.append(arguments)
        return {'content': [{'type': 'text', 'text': json.dumps({'results': [
            {'caller_file_path': str(tmp_path / 'caller.py')}, {'caller_file_path': '../outside.py'}]})}]}
    monkeypatch.setattr(edit_graph.graph, 'call', call)
    sources, trace = edit_graph.expand(tmp_path, evidence(), 'change run')
    assert sources == {'caller.py': 'run()'}
    assert trace['status'] == 'ready'
    assert len(calls) == 2
    assert all(c['repo_path'] == tmp_path.as_posix() and c['context'] == (tmp_path / 'main.py').as_posix() for c in calls)


def test_graph_failure_is_explicit(tmp_path, monkeypatch):
    def offline():
        raise RuntimeError('offline')
    monkeypatch.setattr(edit_graph.graph, 'catalog', offline)
    sources, trace = edit_graph.expand(tmp_path, evidence(), 'change run')
    assert not sources
    assert trace['status'] == 'unavailable'
    assert 'Document-only' in trace['warnings'][0]


def test_no_document_symbols_never_queries_graph(tmp_path, monkeypatch):
    monkeypatch.setattr(edit_graph.graph, 'catalog', lambda: (_ for _ in ()).throw(AssertionError('should not query')))
    sources, trace = edit_graph.expand(tmp_path, DocumentEvidence([]), 'change everything')
    assert not sources and trace['status'] == 'unavailable'
