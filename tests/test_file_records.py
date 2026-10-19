import hashlib
from api.services.wiki.reference import build_reference_pages
from api.services.document_schema import build_schema
from api.services.document_store import chunk_documents
from api.services.document_context import DocumentEvidence, cross_check_sources, focused_source
from api.schemas import ChatCompletionRequest


def test_records_cover_each_readable_file_and_survive_indexing(tmp_path):
    (tmp_path/'worker.py').write_text('"""Save user preferences."""\ndef save(value):\n    return value\n')
    (tmp_path/'entry.py').write_text('from worker import save\ndef run(value):\n    return save(value)\n')
    (tmp_path/'config.json').write_text('{"enabled":true}')
    pages=build_reference_pages(tmp_path,['worker.py','entry.py','config.json'])
    records={p.fileRecord['path']:p.fileRecord for p in pages if p.fileRecord}
    assert set(records)=={'worker.py','entry.py','config.json'}
    assert records['worker.py']['purpose']=='Save user preferences.'
    assert records['worker.py']['symbols'][0]['start_line']==2
    assert 'entry.py' in records['worker.py']['related_files']
    assert records['entry.py']['imports']
    assert records['config.json']['symbols']==[]
    schema=build_schema({p.id:p for p in pages})
    assert schema['file_records']==records
    chunks=chunk_documents({p.id:p for p in pages})
    chunk=next(c for c in chunks if c['files'] and c['files'][0]=='worker.py')
    evidence=DocumentEvidence([chunk])
    assert 'worker.py' in evidence.file_records
    assert 'Save user preferences.' in evidence.record_context('save')
    assert 'entry.py' in evidence.paths


def test_stale_record_uses_live_source_and_warns(tmp_path):
    path=tmp_path/'service.py'; path.write_text('model = "new"\n')
    evidence=DocumentEvidence([{'files':[], 'text':'', 'file_records':[{'path':'service.py',
        'source_sha256':hashlib.sha256(b'old').hexdigest(), 'symbols':[{'name':'model','start_line':500,'end_line':510}]}]}])
    request=ChatCompletionRequest(repo_url=str(tmp_path),type='local',messages=[{'role':'user','content':'change model'}])
    _, sources, gaps=cross_check_sources(request,evidence)
    assert sources['service.py']==path.read_bytes().decode('utf-8')
    assert any('stale' in gap for gap in gaps)
    _, shown=focused_source('service.py',sources['service.py'],evidence,'model')
    assert shown=={1}
