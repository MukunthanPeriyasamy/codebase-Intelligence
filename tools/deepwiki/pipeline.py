"""Pinned DeepWiki components adapted to immutable snapshots and LanceDB.

Upstream remains unmodified. Git ingestion, secret filtering, model transports and
paid-request accounting belong to the Electron host. This service owns chunking,
Lance retrieval and DeepWiki context construction. It never calls a model itself.
"""
import contextlib
import hashlib
import json
import logging
import os
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parent
os.environ['TIKTOKEN_CACHE_DIR'] = str(ROOT / 'token-cache')
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'upstream'))
logging.disable(logging.CRITICAL)

# Keep library diagnostics out of the private JSON-lines protocol.
with contextlib.redirect_stdout(sys.stderr):
    import adalflow as adal
    from adalflow.core.types import Document, RetrieverOutput
    from api.rag.pipeline import LineTrackingTextSplitter
    from api.rag.rag import RAG
    from api.chat import prompt_builder
    import evidence as captured
    import vector_store

VERSION = 'deepwiki-lance-v1'
UPSTREAM = 'd92819a9c9f3b99416e3580ff235fc9d3adf8b89'


def snapshot(request):
    root = Path(request['directory']).resolve()
    db = sqlite3.connect((root / 'index.sqlite3').as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    metadata = dict(db.execute('SELECT key,value FROM metadata'))
    if metadata.get('complete') != '1' or metadata.get('commit') != request['commit']:
        db.close()
        raise ValueError('Snapshot does not match the requested commit')
    return root, db


def plan(request):
    root, db = snapshot(request)
    try:
        splitter = LineTrackingTextSplitter(split_by='word', chunk_size=180, chunk_overlap=40)
        units = {}
        omitted = 0
        for record in db.execute('SELECT path,hash FROM files WHERE hash IS NOT NULL ORDER BY path'):
            if len(units) >= 2000:
                omitted += 1
                continue
            lines = captured.source(root, record)
            text = '\n'.join(lines)
            if not text.strip():
                continue
            chunks = splitter([Document(id=record['hash'], text=text, meta_data={'file_path': record['path']})])
            for chunk in chunks:
                start = chunk.meta_data.get('start_line')
                end = chunk.meta_data.get('end_line')
                # Do not invent coordinates when the upstream splitter cannot map a chunk.
                if not start or not end:
                    raise ValueError('DeepWiki could not map a source chunk to lines')
                end = min(end, len(lines))
                # Citation transport permits bounded source excerpts. Long chunks
                # are subdivided, not silently truncated.
                for first in range(start, end + 1, 40):
                    last = min(first + 39, end)
                    identity = hashlib.sha256(f"{record['path']}:{record['hash']}:{first}:{last}".encode()).hexdigest()
                    if identity in units:
                        continue
                    if len(units) == 2000:
                        omitted += 1
                        continue
                    units[identity] = {'id': identity, 'kind': 'module', 'path': record['path'],
                                       'hash': record['hash'], 'start': first, 'end': last}
        excluded = db.execute('SELECT count(*) FROM files WHERE hash IS NULL').fetchone()[0]
        return {'units': list(units.values()), 'omitted': omitted, 'excluded': excluded}
    finally:
        db.close()


class LanceRAG(RAG):
    """DeepWiki RAG document hydration with its FAISS boundary replaced by LanceDB.

Query embeddings arrive from the host's configured/budgeted provider. No global
upstream provider configuration, model discovery or pickle database is involved.
"""
    def __init__(self, request):
        adal.Component.__init__(self)
        self.request = request
        self.transformed_docs = []
        self.failure = None

    def retriever(self, query):
        try:
            units = vector_store.main(self.request | {'operation': 'search'})
            self.transformed_docs = [Document(id=unit['id'], text='', meta_data=unit) for unit in units]
            return [RetrieverOutput(doc_indices=list(range(len(units))), doc_scores=[], query=query)]
        except Exception as error:
            self.failure = error
            raise


def main(request):
    operation = request.get('operation')
    if operation == 'health':
        return {'adapter': VERSION, 'upstream': UPSTREAM, 'storage': 'lancedb'}
    if operation == 'plan':
        return plan(request)
    if operation == 'search':
        rag = LanceRAG(request)
        result = rag.call('host-embedded-query')
        if rag.failure:
            raise rag.failure  # upstream catches retrieval errors; never hide ours
        return [doc.meta_data for output in result for doc in output.documents]
    if operation in ('lookup', 'put'):
        return vector_store.main(request)
    if operation == 'augment':
        data = request['input']
        if len(json.dumps(data).encode()) > 18000:
            raise ValueError('Context exceeds input budget')
        # All source has already passed host-side redaction and snapshot checks.
        # JSON quoting preserves exact whitespace/line metadata and prevents the
        # formatter from interpreting source as template instructions.
        context = json.dumps({key: data.get(key, []) for key in ('evidence', 'relationships', 'gaps')}, ensure_ascii=False)
        history = json.dumps({'questions': data.get('previousQuestions', []), 'answers': data.get('previousAnswers', [])}, ensure_ascii=False)
        return prompt_builder(system_prompt='', query=json.dumps({'question': data['question'], 'searchesRemaining': data.get('searchesRemaining', 0)}),
                              conversation_history=history, context=context)
    raise ValueError('Unsupported DeepWiki operation')


def diagnostic(error):
    # Never return raw provider, repository or filesystem exception strings.
    if isinstance(error, (ImportError, ModuleNotFoundError)):
        return 'DeepWiki dependencies are missing. Rerun scripts/setup-deepwiki.ps1.'
    if isinstance(error, OSError):
        return 'DeepWiki storage could not be accessed. Check free disk space and folder permissions.'
    return f'DeepWiki pipeline failed ({type(error).__name__}). Rebuild the code index; check the selected embedding model and snapshot.'


if __name__ == '__main__':
    while True:
        line = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
        if not line:
            break
        try:
            if len(line) > 2 * 1024 * 1024:
                raise ValueError('Message limit')
            with contextlib.redirect_stdout(sys.stderr):
                result = main(json.loads(line))
            print(json.dumps({'ok': True, 'data': result}), flush=True)
        except Exception as error:
            print(json.dumps({'ok': False, 'error': diagnostic(error)}), flush=True)
