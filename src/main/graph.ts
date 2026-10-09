import { EvidenceReader } from './evidence';
import { graphSchema } from '../shared/graph';
import type { SnapshotRef } from '../shared/documentation';

export class GraphReader extends EvidenceReader {
  async readGraph(ref: SnapshotRef, preview: boolean, signal?: AbortSignal) {
    const raw = await this.request(ref, { preview }, signal);
    const graph = graphSchema.parse({ ...(raw as Record<string, unknown>), repoId: ref.repoId });
    if (graph.commit !== ref.commit || graph.preview !== preview) throw new Error('Graph scope mismatch');
    const ids = new Set(graph.nodes.map(node => node.id));
    if (graph.edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) throw new Error('Graph edge scope mismatch');
    return graph;
  }
}
