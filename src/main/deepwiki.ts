/** DeepWiki backend adapters. UI contracts and model accounting stay host-owned. */
import { z } from 'zod';
import { EvidenceReader, containsSecret } from './evidence';
import { RetrievalReader } from './retrieval';
import { VectorStore, type VectorService } from './vectors';
import { planSchema, type DocSettings, type SnapshotRef } from '../shared/documentation';
import { retrievalSchema, type Retrieval } from '../shared/chat';
import { CHAT_SYSTEM_PROMPT, chatCompletionSchema, type ChatInput, type ChatProvider } from './chat-provider';
import type { ModelCompletion } from './providers';
import { RepoError } from './git';

export const DEEPWIKI_VERSION = 'deepwiki-lance-v1';
export class DeepWikiStore extends VectorStore {
  constructor(python: string, bridge: string) {
    super(python, bridge, 'DeepWiki pipeline could not start or timed out. Run scripts/setup-deepwiki.ps1, check disk space, then rebuild the code index.');
  }
}
export class DeepWikiEvidenceReader extends EvidenceReader {
  constructor(python: string, evidenceScript: string, private pipeline: DeepWikiStore) { super(python, evidenceScript); }
  override async plan(ref: SnapshotRef, signal = new AbortController().signal) {
    return planSchema.parse(await this.pipeline.operation(ref, { operation: 'plan' }, signal));
  }
}

export class DeepWikiRetrievalReader extends RetrievalReader {
  constructor(python: string, script: string, private graph: EvidenceReader, private index: VectorService) { super(python, script); }
  override async identity(ref: SnapshotRef) { return `${DEEPWIKI_VERSION}:${await this.index.identity(ref)}`; }
  override async retrieve(ref: SnapshotRef, question: string, expanded: boolean, signal: AbortSignal): Promise<Retrieval> {
    // A unique structural location still needs no model or embedding request.
    const lexical = retrievalSchema.parse(await this.graph.retrieveTool(ref, question, expanded, signal));
    if (lexical.exact) return lexical;
    // Never silently route around a broken/unbuilt replacement answer index.
    const semantic = await this.index.search(ref, question, signal);
    if (semantic === null) throw new RepoError('Build the DeepWiki code index in Settings > Code search for this commit and embedding model, then ask again.');
    const result: Retrieval = { ...lexical, exact: false, route: 'hybrid', units: [] };
    const graphUnits: Retrieval['units'] = [];
    for (const seed of semantic.slice(0, expanded ? 3 : 2)) {
      const source = await this.read(ref, seed, signal);
      const symbol = source.symbols.find(item => !containsSecret(item.name));
      if (!symbol) continue;
      const neighbours = retrievalSchema.parse(await this.graph.retrieveTool(ref, `What calls \`${symbol.name}\`?`, true, signal));
      graphUnits.push(...neighbours.units); result.edges.push(...neighbours.edges);
    }
    const ranked = new Map<string, { unit: Retrieval['units'][number]; score: number }>();
    for (const list of [semantic, lexical.units, graphUnits]) {
      [...new Map(list.map(unit => [unit.id, unit])).values()].forEach((unit, rank) => {
        const entry = ranked.get(unit.id) ?? { unit, score: 0 };
        entry.score += 1 / (60 + rank); ranked.set(unit.id, entry);
      });
    }
    result.units = [...ranked.values()].sort((a, b) => b.score - a.score).slice(0, 12).map(item => item.unit);
    result.edges = [...new Map(result.edges.map(edge => [JSON.stringify(edge), edge])).values()].slice(0, 24);
    result.gaps = [...new Set([...result.gaps, 'DeepWiki semantic retrieval is enriched with RepoWise name-matched relationships; these do not prove runtime calls.'])].slice(0, 20);
    return retrievalSchema.parse(result);
  }
}

export class DeepWikiChatProvider implements ChatProvider {
  constructor(private pipeline: DeepWikiStore, private snapshot: () => SnapshotRef | null, private complete: ModelCompletion) {}
  async answer(settings: DocSettings, input: ChatInput, signal: AbortSignal) {
    const ref = this.snapshot();
    if (!ref) throw new RepoError('Connect a repository first.');
    const prompt = z.string().max(20000).parse(await this.pipeline.operation(ref, { operation: 'augment', input }, signal));
    // Upstream builds the context/history/query envelope. Host transports retain
    // cancellation, token caps, schema checks and encrypted-key isolation.
    if (Buffer.byteLength(JSON.stringify(prompt)) > 16000) throw new RepoError('DeepWiki context exceeds the model input budget. Ask a shorter question or start a new conversation.');
    return this.complete(settings, chatCompletionSchema, CHAT_SYSTEM_PROMPT, prompt, signal);
  }
}
