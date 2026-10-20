"""Persistent document RAG: one Chroma database, mandatory metadata isolation.

Collections separate incompatible embedding spaces; repository/session isolation
is always enforced inside queries. No source files are indexed by this service.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import uuid

import httpx

from api.logger import get_logger
from api.services.document_schema import build_schema
from api.utils import deepwiki_root

logger = get_logger(__name__)
VERSION = 1


def repo_key(request):
    from api.services.document_context import identity
    return hashlib.sha256((request.type + ':' + identity(request.repo_url, request.type)).encode()).hexdigest()


def client():
    import chromadb
    from chromadb.config import Settings
    return chromadb.PersistentClient(path=str(Path(deepwiki_root()) / 'document-chroma'),
                                    settings=Settings(anonymized_telemetry=False))


def embed(model, texts):
    from api.services.retries import retry_sync
    host = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
    def request():
        response = httpx.post(host + '/api/embed', json={'model': model, 'input': texts, 'truncate': False}, timeout=120)
        response.raise_for_status()
        return response
    try:
        response = retry_sync(request, 'Document embedding')
        vectors = response.json().get('embeddings', [])
    except (httpx.HTTPError, ValueError) as exc:
        raise ValueError(f'Ollama embedding failed for {model}. Check the server and install this embedding model; no lexical fallback was used.') from exc
    if len(vectors) != len(texts) or not vectors:
        raise ValueError('Ollama returned an incomplete embedding batch')
    dimension = len(vectors[0])
    if not dimension or any(len(v) != dimension or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in v) or not any(v) for v in vectors):
        raise ValueError('Ollama returned invalid or inconsistent embedding vectors')
    return vectors


def chunk_documents(pages):
    values = {key: page.model_dump() if hasattr(page, 'model_dump') else page for key, page in pages.items()}
    schema = build_schema(values)
    chunks = []
    for page_id, entry in schema['pages'].items():
        content = values[page_id]['content']
        for spec in entry['chunks']:
            start, end = spec['start'], spec['end']
            chunks.append(dict(page_id=page_id, title=entry['title'], chunk=spec['id'],
                text=content[start:end], files=entry['files'], areas=entry['areas'],
                source_ranges=entry.get('source_ranges', []),
                file_records=[schema['file_records'][name] for name in entry['files'] if name in schema['file_records']],
                document_start_line=content.count('\n', 0, start) + 1,
                document_end_line=content.count('\n', 0, end) + 1))
    return chunks


def filters(index):
    return {'$and': [{key: {'$eq': index[key]}} for key in ('repo_id', 'session_id', 'language', 'embedding_model')]}


def index_documents(request, pages, progress=None):
    if progress:
        progress('chunking', 'Splitting generated documents into overlapping chunks')
    chunks = chunk_documents(pages)
    if not chunks:
        raise ValueError('No generated document chunks to index')
    index = dict(version=VERSION, status='building', session_id=uuid.uuid4().hex, repo_id=repo_key(request),
                 language=request.language, embedding_model=request.embedding_model, chunk_count=len(chunks))
    collection = None
    try:
        if progress:
            progress('embedding', f'0 / {len(chunks)} chunks · Ollama {request.embedding_model}')
        for offset in range(0, len(chunks), 16):
            batch = chunks[offset:offset + 16]
            vectors = embed(request.embedding_model, [c['title'] + '\n' + c['text'] for c in batch])
            if collection is None:
                index['dimension'] = len(vectors[0])
                space = hashlib.sha256(f'{request.embedding_model}:{index["dimension"]}'.encode()).hexdigest()[:24]
                index['collection'] = 'wiki-' + space
                collection = client().get_or_create_collection(index['collection'], embedding_function=None,
                    metadata={'hnsw:space': 'cosine'})
            if any(len(v) != index['dimension'] for v in vectors):
                raise ValueError('Embedding dimensions changed during indexing')
            metadata = [{**{k: index[k] for k in ('repo_id', 'session_id', 'language', 'embedding_model')},
                         'chunk_data': json.dumps({k: v for k, v in c.items() if k != 'text'})} for c in batch]
            collection.add(ids=[f'{index["session_id"]}:{offset+i}' for i in range(len(batch))],
                           documents=[c['text'] for c in batch], embeddings=vectors, metadatas=metadata)
            if progress:
                progress('embedding', f'{offset + len(batch)} / {len(chunks)} chunks embedded and stored')
        if progress:
            progress('vector_store', 'Verifying persisted session records')
        count = len(collection.get(where=filters(index), include=[])['ids'])
        if count != len(chunks):
            raise ValueError('Chroma document index is incomplete')
        index['status'] = 'ready'
        folder = Path(deepwiki_root()) / 'document-sessions'
        folder.mkdir(parents=True, exist_ok=True)
        temp = folder / (index['session_id'] + '.tmp')
        temp.write_text(json.dumps(index), encoding='utf-8')
        os.replace(temp, folder / (index['session_id'] + '.json'))
        logger.info('Document index ready session=%s chunks=%s model=%s', index['session_id'], count, request.embedding_model)
        return index
    except Exception:
        if collection is not None:
            collection.delete(where=filters(index))
        raise


def session_index(request):
    from api.services.document_context import NoDocumentError, identity
    session = request.document_session_id
    if session:
        file = Path(deepwiki_root()) / 'document-sessions' / (session + '.json')
        if not file.is_file():
            raise ValueError('Document session index not found. Regenerate the wiki.')
        index = json.loads(file.read_text(encoding='utf-8'))
    else:
        candidates = []
        for file in (Path(deepwiki_root()) / 'wikicache').glob('deepwiki_cache_*.json'):
            if file.is_symlink() or file.stat().st_size > 128_000_000:
                continue
            try:
                cache = json.loads(file.read_text(encoding='utf-8'))
                info = cache.get('repo') or {}
                url = info.get('localPath') or info.get('repoUrl') or cache.get('repo_url')
                if url and info.get('type', request.type) == request.type and file.name.endswith('_' + request.language + '.json') and identity(url, request.type) == identity(request.repo_url, request.type):
                    candidates.append((file.stat().st_mtime_ns, cache.get('document_index')))
            except (ValueError, OSError, TypeError):
                continue
        if not candidates:
            raise NoDocumentError()
        index = max(candidates, key=lambda item: item[0])[1]
    if not index or index.get('status') != 'ready' or index.get('version') != VERSION:
        raise ValueError('Document vector index is not ready. Regenerate the wiki to chunk, embed and index its documents.')
    if index.get('repo_id') != repo_key(request) or index.get('language') != request.language:
        raise ValueError('Document session does not belong to this repository and language')
    return index


def retrieve(request, query, top_k=6):
    from api.services.document_context import DocumentEvidence
    index = session_index(request)
    query_vector = embed(index['embedding_model'], [query])[0]
    if len(query_vector) != index['dimension']:
        raise ValueError('Embedding model dimensions changed; regenerate this document index')
    collection = client().get_collection(index['collection'], embedding_function=None)
    result = collection.query(query_embeddings=[query_vector], where=filters(index),
                              n_results=min(top_k, index['chunk_count']), include=['documents', 'metadatas', 'distances'])
    chunks = []
    for text, meta, distance in zip(result['documents'][0], result['metadatas'][0], result['distances'][0]):
        if any(meta.get(key) != index[key] for key in ('repo_id', 'session_id', 'language', 'embedding_model')):
            raise ValueError('Vector store returned an out-of-scope document')
        chunks.append({**json.loads(meta['chunk_data']), 'text': text, 'distance': distance,
                       'session_id': index['session_id']})
    if not chunks:
        raise ValueError('No indexed chunks found in this document session. Regenerate its index.')
    logger.info('Document retrieval session=%s selected=%s', index['session_id'], [(c['page_id'], c['chunk']) for c in chunks])
    return DocumentEvidence(chunks)
