import { EvidenceReader, containsSecret, digest } from './evidence';
import { CHAT_VERSION, retrievalSchema, type Retrieval } from '../shared/chat';
import type { SnapshotRef, Evidence } from '../shared/documentation';

export class RetrievalReader extends EvidenceReader {
  constructor(python: string, script: string, private readonly mcp?: EvidenceReader) { super(python, script); }
  private cache = new Map<string, Retrieval>();
  async retrieve(ref: SnapshotRef, question: string, expanded: boolean, signal: AbortSignal): Promise<Retrieval> {
    signal.throwIfAborted();
    const key = digest(JSON.stringify([CHAT_VERSION, ref, question, expanded]));
    const cached = this.cache.get(key);
    if (cached) return structuredClone(cached);
    const result = retrievalSchema.parse(await (this.mcp ? this.mcp.retrieveTool(ref, question, expanded, signal) : this.request(ref, { operation: 'retrieve', question, expanded }, signal)));
    this.cache.set(key, result);
    if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
    return structuredClone(result);
  }
  async pack(ref: SnapshotRef, retrieval: Retrieval, documentEvidence: Evidence[], signal: AbortSignal, documentIds?: Set<string>): Promise<Evidence[]> {
    const evidence: Evidence[] = [];
    const units = [...retrieval.units.slice(0, 1).map(unit => ({ unit, document: false })), ...documentEvidence.slice(0, 2).map(item => ({ unit: { ...item, kind: 'module' as const }, document: true })), ...retrieval.units.slice(1).map(unit => ({ unit, document: false }))];
    for (const { unit, document } of units) {
      signal.throwIfAborted();
      if (evidence.length === 6) break;
      if (evidence.some(item => item.path === unit.path && item.start <= unit.start && item.end >= unit.end)) continue;
      const item = await this.read(ref, { ...unit, end: Math.min(unit.end, unit.start + 39) }, signal);
      if (!item.text.trim() || item.blocked.length >= item.end - item.start + 1) continue;
      item.symbols = item.symbols.slice(0, 10);
      if (containsSecret(JSON.stringify(item))) continue;
      if (Buffer.byteLength(JSON.stringify([...evidence, item])) <= 11000) { evidence.push(item); if (document) documentIds?.add(item.id); }
    }
    return evidence;
  }
}
