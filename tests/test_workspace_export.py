from types import SimpleNamespace
from api.services.wiki.workspace_export import save_workspace_document


def test_local_export_preserves_previous_versions(tmp_path):
    request = SimpleNamespace(type='local', repo_url=str(tmp_path), language='en')
    pages = {'one': SimpleNamespace(title='Overview', content='Actual documentation')}
    first = save_workspace_document(request, 'Wiki', pages)
    second = save_workspace_document(request, 'Wiki', pages)
    assert first != second
    exports = list(tmp_path.glob('deepwiki-document-*.md'))
    assert len(exports) == 2
    assert all('Actual documentation' in file.read_text(encoding='utf-8') for file in exports)


def test_remote_export_does_not_write(tmp_path):
    request = SimpleNamespace(type='github', repo_url=str(tmp_path), language='en')
    assert save_workspace_document(request, 'Wiki', {}) is None
    assert not list(tmp_path.iterdir())
