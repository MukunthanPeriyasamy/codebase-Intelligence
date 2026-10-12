import type { SourceSelection } from './SourceViewer';
import { useEffect, useRef, useState } from 'react';
import type { Result } from '../shared/contracts';
import { type DocStatus, type DocCatalog, type DocPage } from '../shared/documentation';

export function DocumentationPanel({ docs, repoId, configured, chatRunning, act, onSettings, onSource, onAsk }: { docs?: DocStatus; repoId?: string; configured: boolean; chatRunning?: boolean; onSettings: () => void; onSource: (source: SourceSelection) => void; onAsk: (question: string) => void; act: (action: () => Promise<Result>) => Promise<void> }) {
  const [catalog, setCatalog] = useState<DocCatalog>([]);
  const [page, setPage] = useState<DocPage | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const request = useRef(0);
  const previousPhase = useRef(docs?.phase);
  const running = docs?.phase === 'planning' || docs?.phase === 'generating';
  useEffect(() => {
    let active = true;
    if (docs) void window.desktop.docCatalog().then(result => { if (!active) return; if (result.ok) setCatalog(result.catalog ?? []); else setError(result.error.message); });
    return () => { active = false; };
  }, [repoId, docs?.commit, docs?.phase, docs?.completed, docs?.settings.model]);
  useEffect(() => { request.current++; setPage(null); setCatalog([]); setSearch(''); setError(''); }, [repoId, docs?.commit]);
  useEffect(() => {
    if (['generating', 'planning'].includes(previousPhase.current ?? '') && ['ready', 'partial'].includes(docs?.phase ?? '')) { request.current++; setPage(null); }
    previousPhase.current = docs?.phase;
  }, [docs?.phase]);
  async function open(id: string) {
    const token = ++request.current; setError('');
    const result = await window.desktop.docPage(id);
    if (token !== request.current) return;
    if (result.ok) setPage(result.document ?? null); else setError(result.error.message);
  }
  async function cite(section: number, claim: number, citation: number) {
    if (!page) return;
    const token = ++request.current; setError(''); 
    const result = await window.desktop.docCitation(page.id, section, claim, citation);
    if (token !== request.current) return;
    if (result.ok && result.source) onSource({ evidence: result.source, commit: page.commit, origin: 'documentation' }); else if (!result.ok) setError(result.error.message);
  }
  const filtered = catalog.filter(item => `${item.title} ${item.path}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel" aria-labelledby="documentation-title">
    <div className="panel-heading"><div><span className="section-number">04 / COMMITTED KNOWLEDGE</span><h2 id="documentation-title">Documentation</h2></div><span className="status" data-testid="docs-state">{docs?.phase ?? 'idle'}</span></div>
    {docs?.generationPaused && <div className="setup-hint" role="status"><strong>Documentation generation is paused</strong><p>Chat now uses committed codebase and graph evidence. Existing documents remain available to read.</p><button onClick={() => onAsk('')}>Go to Chat</button></div>}
    <p>Turn committed code into a browsable reference, with source citations for every claim.</p>
    {(!configured || !docs?.settings.model) && <div className="setup-hint"><p>Configure your provider and model in Settings to generate documentation.</p><button onClick={onSettings}>Configure model access</button></div>}
    <p className="muted">{docs?.settings.provider === 'openrouter' ? 'OpenRouter' : 'Ollama'} · {docs?.settings.model || 'No model selected'} · Output limit: {docs?.settings.maxOutputTokens ?? 8000} tokens · {docs?.generationPaused ? 'Generation paused' : docs?.settings.autoGenerate ? 'Automatic generation enabled' : 'Manual generation'} <button className="text-button" onClick={onSettings}>Edit settings</button></p>
    <div className="actions"><button className="primary" disabled={docs?.generationPaused || running || chatRunning || !configured || !docs?.sourceCommit || !docs.settings.model} onClick={() => void act(() => window.desktop.generateDocs())}>Generate / resume documentation</button><button disabled={!running} onClick={() => void act(() => window.desktop.cancelDocs())}>Stop generation</button></div>
    {docs && <p role="status">{docs.completed} / {docs.total} pages · {docs.remaining} remaining · {docs.omitted} excluded/omitted<br />Today: {docs.requestsToday} / {docs.settings.requestsPerDay} requests · {docs.settings.provider === 'openrouter' ? `Reported cost $${docs.reportedCost.toFixed(4)} · ${docs.unknownCostRequests} attempts with unknown cost` : 'Local Ollama'}</p>}
    {docs?.commit && <p>Documentation commit <code>{docs.commit.slice(0, 12)}</code>{docs.commit !== docs.sourceCommit && <strong className="stale"> · Out of date — generate for the latest commit</strong>}</p>}
    {docs?.error && <div className="generation-error" role="alert">
      <h3>Documentation generation stopped</h3><p>{docs.error}</p>
      <details><summary>Debug context</summary><pre>{`Provider: ${docs.settings.provider ?? 'ollama'}\nModel: ${docs.settings.model}\nCommit: ${docs.sourceCommit ?? 'none'}\nOutput token limit: ${docs.settings.maxOutputTokens}\nCompleted pages: ${docs.completed} / ${docs.total}\nError: ${docs.error}`}</pre></details>
      <button onClick={onSettings}>Review generation settings</button>
    </div>}
    {!!docs?.gaps.length && <details><summary>Coverage gaps ({docs.gaps.length})</summary><ul>{docs.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
    {error && <p className="error" role="alert">{error}</p>}
    {!catalog.length && <div className="empty-state"><h3>No documentation published yet</h3><p>{docs?.sourceCommit ? "Choose a model, then generate your first bounded set of pages. Local symbol lookup is already available in Chat." : "Connect a repository and wait for its first snapshot in Repository."}</p></div>}
    {!!catalog.length && <div className="doc-browser">
      <nav aria-label="Documentation pages"><label>Find a page<input value={search} onChange={event => setSearch(event.target.value)} /></label><p>{filtered.length} matches (showing up to 100)</p><div className="doc-page-list">{!filtered.length && <p>No pages match this search.</p>}{filtered.slice(0, 100).map(item => <button key={item.id} aria-pressed={page?.id === item.id} onClick={() => void open(item.id)}>{item.title}<small>{item.kind} · {item.path}</small></button>)}</div></nav>
      <article className="doc-page">{!page ? <p>Select a page to inspect its claims and citations.</p> : <><div className="doc-title-row"><h3>{page.content.title}</h3><button className="quiet" onClick={() => onAsk(`Explain ${page.evidence[0]?.path ?? page.content.title}`)}>Ask about this file</button></div><p className="muted">{page.model} · {page.commit.slice(0, 12)} · {new Date(page.created).toLocaleString()}</p>{page.content.sections.map((section, si) => <section key={si}><h4>{section.title} <small>{section.kind}</small></h4>{section.claims.map((claim, ci) => <div key={ci}><p><span className="claim-basis">{claim.basis}</span> {claim.text}</p><div className="citation-links">{claim.citations.map((citation, ei) => { const evidence = page.evidence.find(item => item.id === citation.evidenceId); return <button key={ei} className="text-button" onClick={() => void cite(si, ci, ei)}>{evidence?.path}:{citation.start}–{citation.end}</button>; })}</div></div>)}</section>)}{!!page.content.gaps.length && <><h4>Uncertainty and gaps</h4><ul>{page.content.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></>}</>}</article>
    </div>}
  </section>;
}
