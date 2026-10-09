import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { RepositoryService } from '../src/main/repositories';
import { DocumentationService } from '../src/main/documentation';
import { ChatService } from '../src/main/chat';
import { RetrievalReader } from '../src/main/retrieval';
import { type ChatProvider, type ChatInput } from '../src/main/chat-provider';
import { defaultDocSettings, type Generated, type SnapshotRef, type DocUnit } from '../src/shared/documentation';
import { digest } from '../src/main/evidence';
import type { Retrieval } from '../src/shared/chat';
import { actionSchema } from '../src/shared/contracts';
import { temporary, python, until } from './helpers';

function content(input: ChatInput): Generated {
  const item = input.evidence[0]!;
  const offset = item.text.split('\n').findIndex((line, i) => line.trim() && !item.blocked.includes(item.start + i));
  return { title: 'Fixture answer', sections: [{ title: 'Supported source', kind: 'module', symbolId: null, claims: [{ text: 'The source contains a function definition.', basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start + offset, end: item.start + offset, quote: item.text.split('\n')[offset]!.slice(0, 120) }] }] }], gaps: ['Fixture response; semantic correctness is not evaluated.'] };
}
class FixtureReader extends RetrievalReader {
  constructor() { super('', ''); }
  override async retrieve(_ref: SnapshotRef, _question: string, expanded: boolean): Promise<Retrieval> {
    return { units: [1, 2, ...(expanded ? [3] : [])].map(index => ({ id: digest(String(index)), path: `${index}.py`, kind: 'module', hash: digest(`source${index}`), start: 1, end: 1 })), route: 'source', exact: false, gaps: [], scanned: 3, edges: [] };
  }
  override async read(_ref: SnapshotRef, unit: DocUnit) { return { id: unit.id, path: unit.path, hash: unit.hash, start: unit.start, end: unit.end, text: `def fixture_${unit.path[0]}(): pass`, symbols: [], blocked: [] }; }
}

test('insufficient answers expand once; chat preempts documentation, shares limits and cancels cleanly', async () => {
  const directory = await temporary('chat-bounds-'); const repoId = randomUUID(); const commit = 'a'.repeat(40);
  const ref = { repoId, repoName: 'fixture', commit, analyzer: 'fixture', directory: join(directory, 'repositories', repoId, 'snapshots', `${commit}-${randomUUID()}`) };
  const reader = new FixtureReader(); let docStarted = false; let block = false; let calls = 0;
  // Documentation plans a real bounded unit via a fixture implementation, without Python.
  reader.plan = async () => ({ units: (await reader.retrieve(ref, '', false)).units, omitted: 0, excluded: 0 });
  const docs = new DocumentationService({ knowledgeDirectory: directory, reader, snapshot: () => ref, changed: () => {}, notify: async () => {}, provider: { async generate(_settings, _kind, _evidence, signal) { docStarted = true; await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); throw new Error('unreachable'); } } });
  const provider: ChatProvider = { async answer(_settings, input, signal) {
    calls++;
    if (block) await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    return { content: { sufficient: input.evidence.length === 3, content: input.evidence.length === 3 ? content(input) : null, gaps: ['Need more supporting source.'] }, cost: 0.001, servedModel: 'test/model' };
  } };
  const chat = new ChatService({ directory, snapshot: () => ref, reader, docs, provider, changed: () => {} });
  try {
    await docs.initialize(); await docs.configure({ ...defaultDocSettings, model: 'test/model', requestsPerRun: 2 });
    docs.start(); await until(() => docStarted);
    chat.start('Explain fixture'); await chat.settle(); assert.equal(docs.status.phase, 'cancelled'); assert.equal(chat.status.phase, 'ready', chat.status.error ?? '');
    assert.equal(calls, 2); assert.equal(chat.status.answers[0]!.expanded, true); assert.equal(docs.status.requestsToday, 3); assert.equal(docs.status.unknownCostRequests, 1);
    await chat.clear(); block = true; chat.start('Explain another fixture'); await until(() => calls === 3);
    assert.equal(docs.start(), false); await assert.rejects(docs.configure(docs.status.settings), /chat/);
    await chat.cancel(); assert.equal(chat.status.phase, 'cancelled'); assert.equal(chat.status.answers.length, 0); assert.equal(docs.status.unknownCostRequests, 2);
    block = false; await docs.configure({ ...docs.status.settings, requestsPerRun: 1 });
    chat.start('Explain with one request'); await chat.settle(); assert.equal(chat.status.answers.at(-1)!.mode, 'insufficient'); assert.equal(calls, 4);
    await chat.clear(); await docs.configure({ ...docs.status.settings, requestsPerRun: 5, requestsPerDay: docs.status.requestsToday + 1 });
    chat.start('Explain at the daily limit'); await chat.settle();
    assert.equal(chat.status.answers.at(-1)!.mode, 'insufficient'); assert.equal(calls, 5);
    assert.ok(chat.status.answers.at(-1)!.gaps.some(gap => gap.includes('daily budget')));
  } finally { await chat.close(); await docs.close(); }
});
test('chat bridge rejects oversized questions, extra paths and arbitrary citation indices', () => {
  for (const action of [{ type: 'chat.ask', question: 'x'.repeat(2001) }, { type: 'chat.ask', question: 'hello', path: 'C:/secret' }, { type: 'chat.citation', id: '../outside', section: 0, claim: 0, citation: 0 }]) assert.equal(actionSchema.safeParse(action).success, false);
});

test('real snapshot chat routes symbols, source, docs and unresolved calls; caches by context and commit', { timeout: 120000 }, async () => {
  const source = await temporary('chat-source-'); const directory = await temporary('chat-service-');
  const exec = promisify(execFile);
  const git = async (...args: string[]) => (await exec('git', ['-C', source, '-c', 'user.name=Chat Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main');
  await writeFile(join(source, 'main.py'), 'def helper():\n    return 1\ndef entry():\n    return helper()\n');
  await writeFile(join(source, 'settings.toml'), 'timeout = 30\n');
  await writeFile(join(source, 'one.py'), 'def repeated(): pass\n');
  await writeFile(join(source, 'two.py'), 'def repeated(): pass\n');
  await writeFile(join(source, '.env'), 'password=never-send-fixture-secret\n');
  await git('add', '.'); await git('commit', '-m', 'first');
  const repos = new RepositoryService({ directory, python, script: resolve('worker/snapshot.py') }, () => {});
  const reader = new RetrievalReader(python, resolve('worker/evidence.py'));
  let calls = 0; let invalid = false; let pending = false; let release: (() => void) | undefined; const inputs: ChatInput[] = [];
  const provider: ChatProvider = { async answer(_settings, input, signal) {
    calls++; inputs.push(structuredClone(input)); assert.equal(JSON.stringify(input).includes('never-send-fixture-secret'), false);
    if (pending) await new Promise<void>((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
    const result = content(input); if (invalid) result.sections[0]!.claims[0]!.citations[0]!.quote = 'fabricated-not-in-source';
    return { content: { sufficient: true, content: result, gaps: [] }, cost: 0.002, servedModel: 'test/model' };
  } };
  const docs = new DocumentationService({ knowledgeDirectory: directory, reader, snapshot: () => repos.getSnapshot(), changed: () => {}, notify: async () => {}, provider: { async generate(_settings, _kind, evidence) { return { content: content({ question: '', previousQuestions: [], evidence, gaps: [] }), cost: 0, servedModel: 'test/model' }; } } });
  const options = { directory, snapshot: () => repos.getSnapshot(), reader, docs, changed: () => {}, provider };
  let chat = new ChatService(options);
  const ask = async (question: string) => { chat.start(question); await chat.settle(); assert.equal(chat.status.phase, 'ready', chat.status.error ?? ''); return chat.status.answers.at(-1)!; };
  try {
    await repos.initialize(); await repos.connect('local', source, ''); await repos.settle(); await docs.initialize();
    const firstRef = repos.getSnapshot()!;
    const direct = await ask('Where is `helper` defined?'); assert.equal(direct.mode, 'direct'); assert.equal(calls, 0);
    assert.match((await chat.citation(direct.id, 0, 0, 0)).text, /def helper/);
    await chat.clear(); assert.equal((await ask('Where is `helper` defined?')).cached, true);
    const graph = await reader.retrieve(firstRef, 'What calls helper?', false, new AbortController().signal);
    assert.equal(graph.route, 'graph'); assert.ok(graph.edges.length > 0); assert.ok(graph.edges.every(edge => edge.resolution === 'unresolved'));
    const ambiguous = await reader.retrieve(firstRef, 'Where is repeated defined?', false, new AbortController().signal);
    assert.equal(ambiguous.exact, false); assert.ok(ambiguous.gaps.some(gap => gap.includes('ambiguous')));
    const config = await reader.retrieve(firstRef, 'timeout settings.toml', false, new AbortController().signal); assert.ok(config.units.some(unit => unit.path === 'settings.toml'));
    await docs.configure({ ...defaultDocSettings, model: 'test/model', requestsPerRun: 10, requestsPerDay: 20 });
    docs.start(); await docs.settle(); assert.ok((await docs.retrieveEvidence(firstRef, 'main.py')).length);
    await chat.clear(); const answer = await ask('Explain helper in main.py'); assert.equal(answer.mode, 'model'); assert.equal(calls, 1);
    await chat.close(); chat = new ChatService(options); const cached = await ask('Explain helper in main.py'); assert.equal(cached.cached, true); assert.equal(calls, 1);
    await ask('Explain helper in main.py'); assert.equal(calls, 2); assert.equal(inputs.at(-1)!.previousQuestions.length, 1);
    await chat.clear(); const missing = await ask('Where is nonexistent_symbol_123 defined?'); assert.equal(missing.mode, 'insufficient'); assert.equal(calls, 2);
    await chat.clear(); await writeFile(join(source, 'main.py'), 'def dirty_only(): pass\n');
    assert.equal((await ask('Where is dirty_only defined?')).mode, 'insufficient');
    await chat.clear(); invalid = true; chat.start('Explain entry'); await chat.settle(); assert.equal(chat.status.phase, 'error'); assert.equal(chat.status.answers.length, 0); invalid = false;
    // An in-flight question remains pinned while a newer snapshot publishes.
    pending = true; chat.start('Explain helper behavior'); await until(() => !!release, 10000);
    await writeFile(join(source, 'main.py'), 'def replacement():\n    return 2\n'); await rename(join(source, 'main.py'), join(source, 'renamed.py'));
    await git('add', '.'); await git('commit', '-m', 'replace and rename'); repos.sync(); await repos.settle(); await docs.refreshContext();
    release!(); pending = false; await chat.settle(); assert.equal(chat.status.phase, 'ready', chat.status.error ?? '');
    const old = chat.status.answers.at(-1)!; assert.equal(old.commit, firstRef.commit); assert.match((await chat.citation(old.id, 0, 0, 0)).text, /def helper/);
    const count = calls; const absent = await ask('Where is helper defined?'); assert.equal(absent.mode, 'insufficient'); assert.equal(calls, count); assert.notEqual(absent.commit, firstRef.commit);
    assert.equal((await ask('Where is replacement defined?')).mode, 'direct');
    assert.throws(() => chat.start('password=super-secret-password'), /secret/);
    // Exhaustion is shared with documentation; structural lookups remain free.
    await docs.configure({ ...docs.status.settings, requestsPerDay: 1 }); await chat.clear(); chat.start('Explain replacement'); await chat.settle(); assert.equal(chat.status.phase, 'error'); assert.match(chat.status.error!, /budget/);
    assert.equal((await ask('Where is replacement defined?')).mode, 'direct');
    // Cache validation checks captured bytes, not just its stored JSON.
    await chat.clear(); await ask('Where is replacement defined?'); const last = chat.status.answers.at(-1)!; await chat.clear();
    await writeFile(join(repos.getSnapshot()!.directory, 'blobs', last.evidence[0]!.hash), 'tampered');
    chat.start('Where is replacement defined?'); await chat.settle(); assert.equal(chat.status.phase, 'error'); assert.match(chat.status.error!, /Cached answer/);
  } finally { await chat.close(); await docs.close(); await repos.close(); }
});
