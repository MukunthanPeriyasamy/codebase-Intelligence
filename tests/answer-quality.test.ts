import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuality } from '../src/main/answer-quality';
import { RetrievalReader } from '../src/main/retrieval';
import type { Evidence, Generated, SnapshotRef } from '../src/shared/documentation';
import type { Retrieval } from '../src/shared/chat';

const item: Evidence = { id: 'a'.repeat(64), path: 'main.py', hash: 'b'.repeat(64), start: 1, end: 3, text: 'def entry():\n    return helper()\n', blocked: [], symbols: [] };
const retrieval: Retrieval = { units: [{ ...item, kind: 'module' }], exact: false, route: 'graph', gaps: [], scanned: 1, edges: [] };
const content: Generated = { title: 'Answer', sections: [{ title: 'Behavior', kind: 'module', symbolId: null, claims: [{ text: 'Calls helper.', basis: 'inferred', citations: [{ evidenceId: item.id, start: 2, end: 2, quote: 'helper()' }] }] }], gaps: [] };

test('confidence distinguishes direct, inferred, uncertain and insufficient answers without assuming graph usage', () => {
  const quality = answerQuality('model', content, [item], [], retrieval, new Set());
  assert.equal(quality.score, 85); assert.equal(quality.sources[0]?.kg, false); assert.equal(quality.sources[0]?.document, false);
  const graph = { ...retrieval, edges: [{ path: item.path, line: 2, target: 'helper', resolution: 'unresolved' as const }] };
  const uncertain = structuredClone(content); uncertain.sections[0]!.claims[0]!.basis = 'uncertain';
  const lower = answerQuality('model', uncertain, [item], ['Missing coverage'], graph, new Set([item.id]));
  assert.ok(lower.score < quality.score); assert.equal(lower.sources[0]?.kg, true); assert.equal(lower.sources[0]?.document, true);
  assert.equal(answerQuality('direct', content, [item], [], retrieval, new Set()).score, 95);
  assert.equal(answerQuality('insufficient', null, [], [], retrieval, new Set()).score, 0);
  assert.equal(answerQuality('model', content, [], [], graph, new Set([item.id])).sources.length, 0);
});

test('document provenance counts accepted excerpts only, not deduplicated candidates', async () => {
  class Reader extends RetrievalReader {
    constructor() { super('', ''); }
    override async read(_ref: SnapshotRef, unit: typeof retrieval.units[number]) { return { ...item, ...unit, text: 'safe text' }; }
  }
  const document = { ...item, id: 'c'.repeat(64), path: 'docs-source.py' };
  const ids = new Set<string>();
  const evidence = await new Reader().pack({} as SnapshotRef, retrieval, [item, document], new AbortController().signal, ids);
  assert.equal(evidence.length, 2); assert.deepEqual([...ids], [document.id]);
});
