import { EvidenceReader, containsSecret, digest } from './evidence';
import { CHAT_VERSION, retrievalSchema, type Retrieval } from '../shared/chat';
import type { SnapshotRef, Evidence } from '../shared/documentation';
import type { VectorService } from './vectors';

export class RetrievalReader extends EvidenceReader {
  constructor(python: string, script: string, private readonly mcp?: EvidenceReader, private readonly vectors?: VectorService) { super(python, script); }
  async identity(ref: SnapshotRef) { return this.vectors ? this.vectors.identity(ref) : 'lexical'; }
  private cache = new Map<string, Retrieval>();
  async retrieve(ref: SnapshotRef, question: string, expanded: boolean, signal: AbortSignal): Promise<Retrieval> {
    signal.throwIfAborted();
    const key = digest(JSON.stringify([CHAT_VERSION, ref, question, expanded, await this.identity(ref)]));
    const cached = this.cache.get(key);
    if (cached) return structuredClone(cached);
    const result = retrievalSchema.parse(await (this.mcp ? this.mcp.retrieveTool(ref, question, expanded, signal) : this.request(ref, { operation: 'retrieve', question, expanded }, signal)));
    if (this.vectors && !result.exact) {
      let semantic = null;
      try { semantic = await this.vectors.search(ref, question, signal); }
      catch { signal.throwIfAborted(); result.gaps.push('Vector retrieval failed; using lexical and graph evidence. Check the embedding provider and LanceDB setup.'); }
      if (semantic === null) result.gaps.push('Code vector index is not ready for this commit/model. Build it in Settings; this answer uses lexical and graph retrieval.');
      else {
        const graphUnits: Retrieval['units'] = [];
        for (const seed of semantic.slice(0, 2)) {
          const source = await this.read(ref, seed, signal);
          const symbol = source.symbols.find(symbol => !containsSecret(symbol.name));
          if (!symbol) continue;
          const query = `What calls \`${symbol.name}\`?`;
          const graph = retrievalSchema.parse(await (this.mcp ? this.mcp.retrieveTool(ref, query, true, signal) : this.request(ref, { operation: 'retrieve', question: query, expanded: true }, signal)));
          graphUnits.push(...graph.units); result.edges.push(...graph.edges); result.gaps.push(...graph.gaps);
        }
        const ranked = new Map<string, { unit: Retrieval['units'][number]; score: number }>();
        for (const list of [semantic, result.units, graphUnits]) [...new Map(list.map(unit => [unit.id, unit])).values()].forEach((unit, index) => { const row = ranked.get(unit.id) ?? { unit, score: 0 }; row.score += 1 / (60 + index); ranked.set(unit.id, row); });
        result.units = [...ranked.values()].sort((a,b) => b.score - a.score).slice(0, 12).map(row => row.unit);
        result.edges = [...new Map(result.edges.map(edge => [JSON.stringify(edge), edge])).values()].slice(0, 24);
        result.gaps = [...new Set(result.gaps)].slice(0, 20);
        result.route = 'hybrid';
        result.gaps = [...result.gaps, 'Semantic retrieval uses bounded, non-redacted code chunks; similarity does not prove relevance or resolved runtime relationships.'].slice(0, 20);
      }
    }
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
