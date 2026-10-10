import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DocumentationService } from '../src/main/documentation';
import { RepositoryService } from '../src/main/repositories';
import { EvidenceReader, digest, redact, validateClaims } from '../src/main/evidence';
import { ProviderError, type DocumentationProvider } from '../src/main/ollama';
import { defaultDocSettings, type Evidence, type Generated, type SnapshotRef } from '../src/shared/documentation';
import { temporary, python, until } from './helpers';

function generated(evidence: Evidence[]): Generated {
  const item = evidence[0]!;
  const offset = item.text.split('\n').findIndex((line, i) => line.trim() && !item.blocked.includes(item.start + i));
  return { title: 'Fixture documentation', sections: [{ title: 'Visible source', kind: 'module', symbolId: null, claims: [{ text: 'The supplied source defines behavior.', basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start + offset, end: item.start + offset, quote: item.text.split('\n')[offset]!.slice(0, 100) }] }] }], gaps: ['Fixture provider; semantic quality is not evaluated.'] };
}
const sample: Evidence = { id: digest('unit'), path: 'main.py', hash: digest('source'), start: 1, end: 2, text: 'def hello():\n    return 1', blocked: [], symbols: [] };

class FixtureReader extends EvidenceReader {
  constructor() { super('', ''); }
  override async plan() { return { units: [{ id: sample.id, kind: 'module' as const, path: sample.path, hash: sample.hash, start: 1, end: 2 }], omitted: 0, excluded: 0 }; }
  override async read() { return structuredClone(sample); }
}

test('commit changes cancel pending generation; interrupted cost and automatic retry state survive restart', async () => {
  const directory = await temporary('docs-cancel-'); const repoId = randomUUID();
  const ref = (commit: string): SnapshotRef => ({ repoId, repoName: 'fixture', commit, analyzer: 'fixture-v1', directory: join(directory, 'repositories', repoId, 'snapshots', `${commit}-${randomUUID()}`) });
  let current = ref('a'.repeat(40)); let calls = 0; let wait = false;
  const provider: DocumentationProvider = { async generate(_settings, _kind, evidence, signal) {
    calls++;
    if (wait) await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); if (signal.aborted) reject(new Error('cancelled')); });
    return { content: generated(evidence), servedModel: 'test/model', cost: null };
  } };
  const options = { knowledgeDirectory: directory, reader: new FixtureReader(), snapshot: () => current, changed: () => {}, notify: async () => {}, provider };
  let docs = new DocumentationService(options);
  try {
    await docs.initialize(); await docs.configure({ ...defaultDocSettings, model: 'test/model', autoGenerate: true });
    docs.start(); await docs.settle(); assert.equal(calls, 1); const published = docs.status.commit;
    wait = true; current = ref('b'.repeat(40)); await docs.refreshContext(); await until(() => calls === 2);
    await docs.cancel(); assert.equal(docs.status.phase, 'cancelled'); assert.equal(docs.status.commit, published);
    await docs.close(); docs = new DocumentationService(options); await docs.initialize(); await docs.settle();
    assert.equal(calls, 2); assert.equal(docs.status.unknownCostRequests, 2);
    // Manual resume is explicit; another commit arriving aborts this owned request.
    docs.start(); await until(() => calls === 3);
    current = ref('c'.repeat(40)); const refreshed = docs.refreshContext(); wait = false; await refreshed; await docs.settle();
    assert.equal(calls, 4); assert.equal(docs.status.commit, current.commit); assert.equal(docs.status.phase, 'ready');
    assert.equal(docs.status.requestsToday, 4);
  } finally { await docs.close(); }
});

test('citation validation rejects invented quotes, invalid spans, redactions and functions', () => {
  validateClaims(generated([sample]), [sample]);
  for (const change of ['quote', 'span', 'redaction', 'function']) {
    const content = generated([sample]); const evidence = structuredClone(sample);
    if (change === 'quote') content.sections[0]!.claims[0]!.citations[0]!.quote = 'does not exist';
    if (change === 'span') content.sections[0]!.claims[0]!.citations[0]!.end = 3;
    if (change === 'redaction') evidence.blocked = [1];
    if (change === 'function') content.sections[0]!.kind = 'function';
    assert.throws(() => validateClaims(content, [evidence]));
  }
  assert.deepEqual(redact('.env', 'VALUE=anything', 1).blocked, [1]);
  assert.deepEqual(redact('main.py', 'password="long-secret-value"\nsafe = 1', 10).blocked, [10]);
});

test('documentation resumes with persistent budgets, excludes secrets, retains stale citations and regenerates on commits', { timeout: 120000 }, async () => {
  const source = await temporary('docs-source-'); const directory = await temporary('docs-service-');
  const exec = promisify(execFile);
  const git = async (...args: string[]) => (await exec('git', ['-C', source, '-c', 'user.name=Doc Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main');
  await writeFile(join(source, 'main.py'), 'def first():\n    return 1\n');
  await writeFile(join(source, '.env'), 'PASSWORD=fixture-sensitive-value\n');
  await git('add', '.'); await git('commit', '-m', 'first');
  const repositories = new RepositoryService({ directory, python, script: resolve('worker/snapshot.py') }, () => {});
  const reader = new EvidenceReader(python, resolve('worker/evidence.py'));
  let calls = 0; let invalid = false;
  const provider: DocumentationProvider = { async generate(_settings, _kind, evidence) {
    calls++; assert.equal(JSON.stringify(evidence).includes('fixture-sensitive-value'), false);
    const content = generated(evidence);
    if (invalid) content.sections[0]!.claims[0]!.citations[0]!.quote = 'fabricated quote';
    return { content, cost: 0.01, servedModel: 'test/model' };
  } };
  const options = { knowledgeDirectory: directory, reader, snapshot: () => repositories.getSnapshot(), changed: () => {}, notify: async () => {}, provider };
  let docs = new DocumentationService(options);
  try {
    await repositories.initialize(); await repositories.connect('local', source, ''); await repositories.settle();
    await docs.initialize(); assert.equal(calls, 0); assert.equal(docs.status.settings.autoGenerate, false);
    await docs.configure({ ...defaultDocSettings, model: 'test/model', requestsPerRun: 1, requestsPerDay: 2 });
    docs.start(); await docs.settle(); assert.equal(calls, 1); assert.equal(docs.status.remaining, 1); assert.equal(docs.status.phase, 'partial');
    const firstCommit = docs.status.commit; const id = docs.catalog()[0]!.id;
    assert.match((await docs.citation(id, 0, 0, 0)).text, /def first/);
    await docs.close(); docs = new DocumentationService(options); await docs.initialize();
    assert.equal(docs.status.requestsToday, 1);
    docs.start(); await docs.settle(); assert.equal(calls, 2); assert.equal(docs.status.remaining, 0);
    docs.start(); await docs.settle(); assert.equal(calls, 2);
    await writeFile(join(source, 'main.py'), 'def second():\n    return 2\n'); await git('add', '.'); await git('commit', '-m', 'second');
    repositories.sync(); await repositories.settle(); await docs.refreshContext();
    assert.equal(docs.status.commit, firstCommit); assert.notEqual(docs.status.sourceCommit, firstCommit); assert.equal(calls, 2);
    assert.match((await docs.citation(id, 0, 0, 0)).text, /def first/);
    docs.start(); await docs.settle(); assert.equal(calls, 2); assert.ok(docs.status.remaining > 0);
    await docs.configure({ ...docs.status.settings, requestsPerDay: 10 }); invalid = true;
    docs.start(); await docs.settle(); assert.equal(docs.status.phase, 'error'); assert.match(docs.status.error!, /citation/);
    assert.equal(docs.status.commit, firstCommit); // Failed replacement retains published documentation.
    invalid = false; docs.start(); await docs.settle(); assert.equal(docs.catalog().length, 1);
    const latest = await docs.page(docs.catalog()[0]!.id); assert.equal(latest.commit, repositories.getSnapshot()!.commit);
    const evidence = latest.evidence[0]!;
    await writeFile(join(repositories.getSnapshot()!.directory, 'blobs', evidence.hash), 'corrupt');
    await assert.rejects(docs.citation(latest.id, 0, 0, 0), /could not be verified/);
    const ledger = await readFile(join(directory, 'documentation/settings.json'), 'utf8'); assert.equal(ledger.includes('fake-key'), false);
  } finally { await docs.close(); await repositories.close(); }
});


test('failed generation keeps reported cost, exposes actionable failure and does not retry automatically', async () => {
  const directory = await temporary('docs-error-'); const repoId = randomUUID();
  const current: SnapshotRef = { repoId, repoName: 'fixture', commit: 'a'.repeat(40), analyzer: 'fixture-v1', directory: join(directory, 'repositories', repoId, 'snapshots', `${'a'.repeat(40)}-${randomUUID()}`) };
  let calls = 0; const notices: string[] = [];
  const options = { knowledgeDirectory: directory, reader: new FixtureReader(), snapshot: () => current, changed: () => {}, notify: async (_kind: string, _title: string, body: string) => { notices.push(body); }, provider: { async generate(): Promise<never> { calls++; throw new ProviderError('[output-truncated] Increase output tokens.', 0.02); } } };
  let docs = new DocumentationService(options);
  try {
    await docs.initialize(); await docs.configure({ ...defaultDocSettings, model: 'test/model', autoGenerate: true });
    docs.start(); await docs.settle();
    assert.equal(docs.status.phase, 'error'); assert.match(docs.status.error!, /output-truncated/);
    assert.equal(docs.status.reportedCost, 0.02); assert.equal(docs.status.unknownCostRequests, 0);
    assert.equal((await docs.catalog()).length, 0); assert.match(notices[0]!, /Increase output tokens/);
    await docs.close(); docs = new DocumentationService(options); await docs.initialize(); await docs.settle();
    assert.equal(calls, 1); assert.equal(docs.status.reportedCost, 0.02);
  } finally { await docs.close(); }
});


test('OpenRouter settings migrate once to manual Ollama setup without losing historical accounting', async () => {
  const directory = await temporary('ollama-migration-');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(directory, 'documentation'));
  const { provider: _provider, ...legacy } = defaultDocSettings;
  await writeFile(join(directory, 'documentation/settings.json'), JSON.stringify({ version: 1, settings: { ...legacy, model: 'anthropic/claude-sonnet-4.6', autoGenerate: true, maxOutputTokens: 2000 }, day: new Date().toISOString().slice(0, 10), requests: 10, cost: 0.04, unknown: 8 }));
  const docs = new DocumentationService({ knowledgeDirectory: directory, reader: new FixtureReader(), snapshot: () => null, changed: () => {}, notify: async () => {} });
  try {
    await docs.initialize(); assert.equal(docs.status.settings.provider, 'ollama'); assert.equal(docs.status.settings.model, '');
    assert.equal(docs.status.settings.autoGenerate, false); assert.equal(docs.status.settings.maxOutputTokens, 8000);
    assert.equal(docs.status.requestsToday, 10); assert.equal(docs.status.reportedCost, 0.04);
    assert.match(await readFile(join(directory, 'documentation/settings.before-ollama.json'), 'utf8'), /anthropic/);
  } finally { await docs.close(); }
});


test('provider switching preserves profiles and accounting, disables automation and separates jobs', async () => {
  const directory = await temporary('provider-switch-'); const repoId = randomUUID(); const commit = 'a'.repeat(40);
  const ref: SnapshotRef = { repoId, repoName: 'fixture', commit, analyzer: 'fixture', directory: join(directory, 'repositories', repoId, 'snapshots', `${commit}-${randomUUID()}`) };
  const calls: string[] = [];
  const options = { knowledgeDirectory: directory, reader: new FixtureReader(), snapshot: () => ref, changed: () => {}, notify: async () => {}, provider: { async generate(settings: typeof defaultDocSettings, _kind: string, evidence: Evidence[]) { calls.push(settings.provider!); return { content: generated(evidence), cost: 0, servedModel: settings.model }; } } };
  let docs = new DocumentationService(options);
  try {
    await docs.initialize(); await docs.configure({ ...defaultDocSettings, model: 'same/model', autoGenerate: true }); docs.start(); await docs.settle();
    await docs.configure({ ...docs.status.settings, provider: 'openrouter', model: 'same/model', autoGenerate: true });
    assert.equal(docs.status.settings.autoGenerate, false); assert.equal(docs.status.settings.profiles?.ollama?.model, 'same/model');
    docs.start(); await docs.settle(); assert.deepEqual(calls, ['ollama', 'openrouter']);
    assert.equal(docs.status.requestsToday, 2); await docs.close(); docs = new DocumentationService(options); await docs.initialize();
    assert.equal(docs.status.settings.provider, 'openrouter'); assert.equal(docs.status.settings.profiles?.ollama?.model, 'same/model'); assert.equal(docs.status.requestsToday, 2);
  } finally { await docs.close(); }
});
