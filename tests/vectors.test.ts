import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceReader } from '../src/main/evidence';
import { VectorService, VectorStore, type Embed } from '../src/main/vectors';
import { DocumentationService } from '../src/main/documentation';
import { RetrievalReader } from '../src/main/retrieval';
import { ChatService } from '../src/main/chat';
import { defaultDocSettings, type SnapshotRef } from '../src/shared/documentation';
import { temporary, python, until } from './helpers';

test('real LanceDB persists, resumes, isolates models and commits, reuses vectors and seeds graph retrieval', { timeout: 180000 }, async () => {
  const directory = await temporary('vectors-'); const repoId = randomUUID();
  const make = async (commit: string, files: Record<string,string>): Promise<SnapshotRef> => {
    const folder = join(directory, 'repositories', repoId, 'snapshots', `${commit}-${randomUUID()}`);
    await promisify(execFile)(python, ['-I', '-c', `import sys,json,sqlite3,hashlib
from pathlib import Path
p=Path(sys.argv[1]);(p/'blobs').mkdir(parents=True)
c=sqlite3.connect(p/'index.sqlite3');c.executescript('CREATE TABLE metadata(key,value); CREATE TABLE files(path,hash,size,status,symbols,calls);')
c.executemany('INSERT INTO metadata VALUES (?,?)',[('complete','1'),('commit',sys.argv[2])])
for name,text in json.loads(sys.argv[3]).items():
 h=hashlib.sha256(text.encode()).hexdigest();Path(chr(92)*2+'?'+chr(92)+str(p/'blobs'/h)).write_bytes(text.encode('utf-8'))
 symbol={'id':name+':f','name':'receive','kind':'function','start':1,'end':2}
 c.execute('INSERT INTO files VALUES (?,?,?,?,?,?)',(name,h,len(text),'parsed',json.dumps([symbol]),'[]'))
c.commit();c.close()`, folder, commit, JSON.stringify(files)], { windowsHide: true });
    return { directory: folder, commit, repoId, repoName: 'vector-fixture', analyzer: 'fixture' };
  };
  let ref = await make('a'.repeat(40), { '.env': 'password=never-send-secret\n', 'input.py': 'def receive():\n    return "incoming payload"\n', 'gone.py': 'def old():\n    return "obsolete"\n' });
  const reader = new EvidenceReader(python, resolve('worker/evidence.py'));
  const store = new VectorStore(python, resolve('worker/vector_bridge.py'));
  const docs = new DocumentationService({ generationPaused: true, knowledgeDirectory: directory, snapshot: () => ref, reader, changed: () => {}, notify: async () => {} });
  let embedded = 0;
  const embed: Embed = async (_settings, texts) => { assert.ok(texts.every(text => !text.includes('never-send-secret'))); embedded += texts.length; return texts.map(text => text.includes('obsolete') ? [0, 1] : [1, 0]); };
  const options = { snapshot: () => ref, docs, reader, store, embed, changed: () => {} };
  let service = new VectorService(options);
  try {
    await docs.initialize(); await docs.configure({ ...defaultDocSettings, model: 'fixture-chat', embeddingModel: 'fixture-embed' });
    assert.equal(await service.ready(ref), false);
    service.start(); await service.settle(); assert.equal(service.status.phase, 'ready', service.status.error ?? ''); assert.equal(embedded, 2);
    const old = ref; service = new VectorService(options); assert.equal(await service.ready(ref), true);
    service.start(); await service.settle(); assert.equal(embedded, 2, 'resume must reuse vectors');
    const hybrid = new RetrievalReader(python, resolve('worker/evidence.py'), undefined, service);
    const retrieved = await hybrid.retrieve(ref, 'source ingress', false, new AbortController().signal);
    assert.equal(retrieved.route, 'hybrid'); assert.ok(retrieved.units.some(unit => unit.path === 'input.py'));
    ref = await make('b'.repeat(40), { 'input.py': 'def receive():\n    return "incoming payload"\n', 'new.py': 'def receive():\n    return "new data"\n' });
    const before = embedded; assert.equal(await service.ready(ref), false);
    await service.contextChanged(); await service.settle(); assert.equal(service.status.phase, 'ready', service.status.error ?? ''); assert.equal(embedded, before + 1);
    const hits = await service.search(ref, 'source ingress', new AbortController().signal);
    assert.ok(hits?.length); assert.ok(hits?.every(hit => hit.path !== 'gone.py'));
    assert.ok((await service.search(old, 'obsolete', new AbortController().signal))?.some(hit => hit.path === 'gone.py'));
    await docs.configure({ ...docs.status.settings, embeddingModel: 'different-embedding-model' });
    assert.equal(await service.ready(ref), false); assert.equal(await service.search(ref, 'input', new AbortController().signal), null);
    let started = false;
    const blocked = new VectorService({ ...options, embed: async (_settings, _texts, signal) => { started = true; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); } });
    blocked.start(); await until(() => started, 30000); await blocked.cancel(); assert.equal(blocked.status.phase, 'cancelled'); assert.equal(await blocked.ready(ref), false);
    await assert.rejects(store.operation({ ...ref, commit: 'c'.repeat(40) }, { operation: 'search', profile: 'a'.repeat(64), vector: [1,0] }, new AbortController().signal));
    await docs.configure({ ...docs.status.settings, embeddingModel: 'fixture-embed' });
    let received = false;
    const chat = new ChatService({ useDocuments: false, directory, snapshot: () => ref, reader: hybrid, docs, changed: () => {}, provider: { async answer(_settings, input) {
      const item = input.evidence[0]!; received = input.evidence.some(item => item.path === 'input.py');
      return { cost: 0, servedModel: 'fixture', content: { sufficient: true, gaps: [], content: { title: 'Inputs', gaps: [], sections: [{ title: 'Source evidence', kind: 'module', symbolId: null, claims: [{ text: 'This captured file defines a function.', basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start, end: item.start, quote: item.text.split('\n')[0]! }] }] }] } } };
    } } });
    try {
      chat.start('Describe incoming inputs'); await chat.settle();
      assert.equal(chat.status.phase, 'ready', chat.status.error ?? ''); assert.equal(received, true);
      const answer = chat.status.answers[0]!; assert.equal(answer.route, 'hybrid'); assert.equal(answer.mode, 'model');
      assert.ok((await chat.citation(answer.id, 0, 0, 0)).text.length);
    } finally { await chat.close(); }
  } finally { await service.cancel(); await docs.close(); }
});
