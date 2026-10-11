import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { KnowledgeGraph as Graph } from '../shared/graph';
import type { RepositoryStatus } from '../shared/repository';

export function KnowledgeGraph({ sync, active }: { sync?: RepositoryStatus; active: boolean }) {
  const [graph, setGraph] = useState<Graph | null>(null); const [error, setError] = useState('');
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState(''); const [refresh, setRefresh] = useState(0);
  const repoId = sync?.repository?.id; const commit = sync?.repository?.active?.commit;
  const building = ['cloning', 'checking', 'indexing'].includes(sync?.phase ?? '');
  useEffect(() => { setGraph(null); setSelected(''); setQuery(''); setError(''); }, [repoId]);
  useEffect(() => {
    if (!active || !repoId) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const result = await window.desktop.repositoryGraph();
        if (disposed) return;
        if (result.ok) { if (!result.graph || result.graph.repoId === repoId) setGraph(result.graph ?? null); setError(''); }
        else setError(building ? 'Waiting for the next committed indexing checkpoint…' : result.error.message);
      } catch { if (!disposed) setError('Graph refresh unavailable. Retry when the desktop service is ready.'); }
      finally { if (!disposed) timer = setTimeout(() => void read(), 3000); }
    }
    void read(); return () => { disposed = true; clearTimeout(timer); };
  }, [active, repoId, commit, building, refresh]);
  const { nodes, edges } = useMemo(() => {
    const items = graph?.nodes ?? []; const matches = new Set(items.filter(node => `${node.label} ${node.path}`.toLowerCase().includes(query.toLowerCase())).map(node => node.id));
    const positions = { file: 0, symbol: 0, unresolved: 0 };
    const nodes: Node[] = items.filter(node => matches.has(node.id)).map(node => ({ id: node.id, data: { label: `${node.label}${node.kind === 'unresolved' ? ' (?)' : ''}` }, position: { x: ({ file: 0, symbol: 340, unresolved: 680 })[node.kind], y: positions[node.kind]++ * 88 }, className: `kg-node kg-${node.kind}`, selected: node.id === selected, sourcePosition: 'right' as Node['sourcePosition'], targetPosition: 'left' as Node['targetPosition'] }));
    const edges: Edge[] = (graph?.edges ?? []).filter(edge => matches.has(edge.source) && matches.has(edge.target)).map(edge => ({ ...edge, label: edge.kind === 'calls' ? 'unresolved call' : 'contains', animated: !!graph?.preview, style: { stroke: edge.kind === 'calls' ? '#dbb57e' : '#6c9e88', strokeDasharray: edge.kind === 'calls' ? '5 5' : undefined } }));
    return { nodes, edges };
  }, [graph, query, selected]);
  const detail = graph?.nodes.find(node => node.id === selected);
  return <section className="kg-dashboard" aria-label="Knowledge graph dashboard">
    <div className="panel-heading"><div><h2>Live knowledge graph</h2><p className="muted">{graph ? `${graph.preview ? 'Building preview' : 'Published snapshot'} · ${graph.commit.slice(0, 12)}` : 'Waiting for indexed files'}</p></div><button onClick={() => setRefresh(value => value + 1)}>Refresh graph</button></div>
    {building && <div className="sync-progress" role="status">{sync?.phase === 'indexing' ? `Building graph · ${sync.processed} / ${sync.total} files indexed` : `${sync?.phase} repository…`}<progress max={Math.max(sync?.total ?? 0, 1)} value={sync?.processed ?? 0} /></div>}
    <div className="kg-stats"><span>{graph?.files ?? 0} indexed files</span><span>{graph?.nodes.length ?? 0} displayed nodes</span><span>{graph?.edges.length ?? 0} displayed relationships</span><span className="status">{sync?.phase ?? 'idle'}</span></div>
    {error && <p role="status" className="muted">{error}</p>}{sync?.error && <p role="alert" className="error">{sync.error}</p>}
    {graph && !graph.preview && graph.commit !== commit && <p className="stale">Refreshing the graph for the new published commit…</p>}
    <label htmlFor="graph-filter">Find a file or symbol</label><input id="graph-filter" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter displayed nodes" />
    <div className="kg-canvas" data-testid="graph-canvas">
      {nodes.length ? <ReactFlow key={`${repoId}:${graph?.commit}:${query}`} nodes={nodes} edges={edges} fitView minZoom={0.08} maxZoom={2} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} colorMode="light" onNodeClick={(_event, node) => setSelected(node.id)}><Background /><Controls showInteractive={false} /><MiniMap pannable zoomable /></ReactFlow> : <div className="empty-state"><h3>{query ? 'No matching displayed nodes' : building ? 'Indexing committed source…' : 'No graph available yet'}</h3><p>{query ? 'Clear the filter to see the graph.' : 'Connect a repository. Files and extracted symbols appear as indexing checkpoints are saved.'}</p></div>}
    </div>
    <div className="kg-legend"><span>Mint: files</span><span>Blue: symbols</span><span>Amber / dashed: unresolved call targets</span></div>
    {detail && <div className="kg-detail" role="region" aria-label="Selected graph node"><strong>{detail.label}</strong><p>{detail.path}{detail.line ? `:${detail.line}` : ''} · {detail.detail}</p></div>}
    <p className="muted kg-note">{graph?.limited ? 'Bounded preview: some nodes and relationships are omitted. ' : ''}Up to 60 files, 240 nodes and 400 relationships. Calls are extracted names, not proven runtime dependencies. Building previews are not used by chat or citations.</p>
  </section>;
}
