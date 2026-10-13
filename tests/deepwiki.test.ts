import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceReader } from '../src/main/evidence';
import { VectorService, type Embed } from '../src/main/vectors';
import { DocumentationService } from '../src/main/documentation';
import { DEEPWIKI_VERSION, DeepWikiStore, DeepWikiEvidenceReader, DeepWikiRetrievalReader, DeepWikiChatProvider } from '../src/main/deepwiki';
import { ChatService } from '../src/main/chat';
import { defaultDocSettings, type SnapshotRef, type Evidence } from '../src/shared/documentation';
import { temporary, python, until } from './helpers';

test('DeepWiki runtime indexes, resumes, isolates commits/models and constructs cited chat context', { timeout: 180000 }, async () => {
  process.env.CODEBASE_INTELLIGENCE_DEEPWIKI_HOME ??= resolve('.local/deepwiki-tool');
  const directory = await temporary('deepwiki-'); const repoId = randomUUID();
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
  const store = new DeepWikiStore(python, resolve('worker/deepwiki_bridge.py'));
  const reader = new DeepWikiEvidenceReader(python, resolve('worker/evidence.py'), store);
  const docs = new DocumentationService({ generationPaused: true, knowledgeDirectory: directory, snapshot: () => ref, reader, changed: () => {}, notify: async () => {} });
  let embedded = 0;
  const embed: Embed = async (_settings, texts) => { assert.ok(texts.every(text => !text.includes('never-send-secret'))); embedded += texts.length; return texts.map(text => text.includes('obsolete') ? [0, 1] : [1, 0]); };
  const options = { version: DEEPWIKI_VERSION, snapshot: () => ref, docs, reader, store, embed, changed: () => {} };
  let service = new VectorService(options);
  try {
    await docs.initialize(); await docs.configure({ ...defaultDocSettings, model: 'fixture-chat', embeddingModel: 'fixture-embed' });
    assert.equal(await service.ready(ref), false);
    const oldService = new VectorService({ ...options, version: 'code-vectors-v1' });
    assert.notEqual(await service.identity(ref), await oldService.identity(ref), 'old indexes must not be reused');
    const unbuilt = new DeepWikiRetrievalReader(python, resolve('worker/evidence.py'), new EvidenceReader(python, resolve('worker/evidence.py')), service);
    await assert.rejects(unbuilt.retrieve(ref, 'Explain input processing', false, new AbortController().signal), /Build the DeepWiki code index/);
    service.start(); await service.settle(); assert.equal(service.status.phase, 'ready', service.status.error ?? ''); assert.equal(embedded, 2);
    const old = ref; service = new VectorService(options); assert.equal(await service.ready(ref), true);
    service.start(); await service.settle(); assert.equal(embedded, 2, 'resume must reuse vectors');
    const hybrid = new DeepWikiRetrievalReader(python, resolve('worker/evidence.py'), new EvidenceReader(python, resolve('worker/evidence.py')), service);
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
    const provider = new DeepWikiChatProvider(store, () => ref, async (_settings, schema, _system, input) => {
      assert.equal(typeof input, 'string'); const prompt = input as string;
      assert.ok(prompt.includes('<START_OF_CONTEXT>')); assert.ok(prompt.includes('<conversation_history>'));
      const context = JSON.parse(prompt.split('<START_OF_CONTEXT>\n')[1]!.split('\n<END_OF_CONTEXT>')[0]!) as { evidence: Evidence[] };
      const item = context.evidence[0]!; received = context.evidence.some(item => item.path === 'input.py');
      return { cost: 0, servedModel: 'fixture', content: schema.parse({ sufficient: true, gaps: [], content: { title: 'Inputs', gaps: [], sections: [{ title: 'Source evidence', kind: 'module', symbolId: null, claims: [{ text: 'This captured file defines a function.', basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start, end: item.start, quote: item.text.split('\n')[0]! }] }] }] } }) };
    });
    const chat = new ChatService({ useDocuments: false, directory, snapshot: () => ref, reader: hybrid, docs, changed: () => {}, provider });
    try {
      chat.start('Describe incoming inputs'); await chat.settle();
      assert.equal(chat.status.phase, 'ready', chat.status.error ?? ''); assert.equal(received, true);
      const answer = chat.status.answers[0]!; assert.equal(answer.route, 'hybrid'); assert.equal(answer.mode, 'model');
      assert.ok((await chat.citation(answer.id, 0, 0, 0)).text.length);
      await chat.clear(); chat.start('Describe incoming inputs'); await chat.settle();
      assert.equal(chat.status.phase, 'ready', chat.status.error ?? '');
      assert.equal(chat.status.answers[0]?.cached, true);
    } finally { await chat.close(); }
    const long = await make('d'.repeat(40), { 'unicode.py': Array.from({ length: 240 }, (_, i) => `value_${i} = "café input processing line ${i}"`).join('\n') });
    const planned = await reader.plan(long);
    assert.ok(planned.units.length > 6, 'upstream overlap must produce multiple source chunks');
    const covered = new Set<number>();
    for (const unit of planned.units) {
      assert.ok(unit.end - unit.start < 40);
      const source = await reader.read(long, unit);
      assert.equal(source.text.split('\n')[0], `value_${unit.start - 1} = "café input processing line ${unit.start - 1}"`);
      for (let line = unit.start; line <= unit.end; line++) covered.add(line);
    }
    assert.equal(covered.size, 240, 'no source lines lost at overlap boundaries');
  } finally { await service.cancel(); await docs.close(); }
});
