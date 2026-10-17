import json
from pathlib import Path
import pytest
from api.schemas import ChatCompletionRequest
from api.services import document_store as store

@pytest.fixture
def environment(tmp_path, monkeypatch):
    monkeypatch.setenv('DEEPWIKI_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(store, 'embed', lambda model, texts: [[1., float('groq' in text.lower()), float('theme' in text.lower())] for text in texts])
    return tmp_path

def request(repo='one', **kwargs):
    return ChatCompletionRequest(repo_url='https://github.com/test/' + repo, messages=[{'role':'user','content':'Which LLM?'}], **kwargs)

def pages(text):
    return {'overview': {'title':'Overview', 'content':text, 'filePaths':[]}}

def test_persistent_sessions_and_repository_isolation(environment):
    a=store.index_documents(request(), pages('Groq llama model'))
    b=store.index_documents(request(), pages('New session theme blue'))
    c=store.index_documents(request('two'), pages('Other repository secrets'))
    assert a['collection']==b['collection']==c['collection']
    for index, expected in [(a,'Groq'),(b,'New session')]:
        result=store.retrieve(request(document_session_id=index['session_id']), 'Groq')
        assert len(result.chunks)==1 and expected in result.chunks[0]['text']
    with pytest.raises(ValueError, match='does not belong'):
        store.retrieve(request('two', document_session_id=a['session_id']), 'Groq')
    with pytest.raises(ValueError, match='does not belong'):
        store.retrieve(request(language='fr', document_session_id=a['session_id']), 'Groq')
    assert (environment/'document-chroma'/'chroma.sqlite3').is_file()
    assert len(store.client().get_collection(a['collection']).get(where=store.filters(a))['ids'])==1

def test_entire_document_indexed_and_progress(environment):
    events=[]
    index=store.index_documents(request(), pages('A meaningful document. '*20000), lambda stage,detail: events.append(stage))
    assert index['chunk_count']>256
    assert events[0]=='chunking' and events[-1]=='vector_store' and 'embedding' in events
    assert len(store.client().get_collection(index['collection']).get(where=store.filters(index))['ids'])==index['chunk_count']

def test_partial_failure_rolls_back(environment, monkeypatch):
    calls=[]
    def embed(model,texts):
        calls.append(1)
        if len(calls)>1: raise ValueError('offline')
        return [[1.,0.,0.] for _ in texts]
    monkeypatch.setattr(store,'embed',embed)
    with pytest.raises(ValueError,match='offline'):
        store.index_documents(request(),pages('content '*6000))
    assert not list((environment/'document-sessions').glob('*.json'))
    assert all(c.count()==0 for c in store.client().list_collections())

def test_old_cache_requires_index_no_fallback(environment):
    folder=environment/'wikicache'; folder.mkdir()
    (folder/'deepwiki_cache_github_test_one_en.json').write_text(json.dumps({'repo':{'type':'github','repoUrl':request().repo_url},'generated_pages':pages('Groq')}))
    with pytest.raises(ValueError,match='vector index is not ready'):
        store.retrieve(request(),'LLM')

@pytest.mark.asyncio
async def test_answer_uses_documents_without_source_validation(environment, monkeypatch):
    from api.services import document_chat
    index=store.index_documents(request(),pages('Application LLM is Groq llama-3.3-70b-versatile.'))
    prompts=[]
    class Streamer:
        async def respond_stream(self,prompt):
            prompts.append(prompt)
            yield 'The documented LLM is llama-3.3-70b-versatile on Groq [D1].'
    monkeypatch.setattr(document_chat.ChatStreamer,'create',lambda **kwargs:Streamer())
    monkeypatch.setattr(document_chat,'get_model_config',lambda *args:{'model_kwargs':{}})
    stream=await document_chat.document_chat(request(document_session_id=index['session_id']))
    result=''.join([part async for part in stream])
    assert 'Groq' in result and '[D1]' in result
    assert len(prompts)==1 and 'llama-3.3-70b-versatile' in prompts[0]
    assert 'Do not claim source cross-validation' in prompts[0]

def test_retrieval_inspection_endpoint(environment):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers.chat import router
    index=store.index_documents(request(),pages('Groq inference details'))
    app=FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        response=client.post('/documents/retrieve',json=request(document_session_id=index['session_id']).model_dump())
        assert response.status_code==200
        assert response.json()['source_cross_validation'] is False
        assert response.json()['chunks'][0]['text']=='Groq inference details'
        missing=client.post('/documents/retrieve',json=request('missing').model_dump())
        assert missing.status_code==404 and missing.json()['detail']=='No document Found Generate One'

@pytest.mark.parametrize('vectors', [[], [[0.,0.]], [[float('nan'),1.]]])
def test_embed_rejects_invalid_vectors(monkeypatch, vectors):
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'embeddings':vectors}
    monkeypatch.setattr(store.httpx,'post',lambda *args,**kwargs:Response())
    with pytest.raises(ValueError): store.embed('nomic-embed-text',['hello'])

@pytest.mark.asyncio
async def test_generation_publishes_only_after_vector_index(environment, monkeypatch):
    from api.services.wiki import tasks
    from api.schemas import WikiTaskRequest, WikiPage, WikiStructureModel, TaskStatus
    task=tasks.WikiTask.from_wiki_request(WikiTaskRequest(owner='test',repo='one',repo_url=request().repo_url))
    page=WikiPage(id='overview',title='Overview',content='Groq application model',filePaths=[],importance='high',relatedPages=[])
    async def structure(task): return WikiStructureModel(id='wiki',title='Wiki',description='',pages=[page])
    async def generate(*args): return {'overview':page}
    saved=[]
    async def save(task,pages):
        assert task.document_index['status']=='ready'
        assert store.retrieve(request(document_session_id=task.document_index['session_id']),'Groq').chunks
        saved.append(True)
    monkeypatch.setattr(tasks,'repo_index_exist',lambda *args:True)
    monkeypatch.setattr(tasks,'_determine_structure',structure)
    monkeypatch.setattr(tasks,'_generate_pages',generate)
    monkeypatch.setattr(tasks,'_save',save)
    await tasks.generate_repo_wiki(task)
    assert task.status==TaskStatus.COMPLETED and saved
    states={stage['id']:stage['state'] for stage in task.pipeline}
    assert all(states[key]=='completed' for key in ('chunking','embedding','vector_store','save'))
