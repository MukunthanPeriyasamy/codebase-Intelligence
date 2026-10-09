import { KnowledgeGraph } from './KnowledgeGraph';
import { useState } from 'react';
import type { Result } from '../shared/contracts';
import type { RepositoryStatus } from '../shared/repository';

export function RepositoryPanel({ sync, act, busy, active: visible }: { active: boolean; sync: RepositoryStatus | undefined; act: (action: () => Promise<Result>, success?: string) => Promise<void>; busy: boolean }) {
  const [tab, setTab] = useState<'repository' | 'graph'>('repository');
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [autoPending, setAutoPending] = useState<boolean | null>(null);
  const repository = sync?.repository;
  const working = ['cloning', 'checking', 'indexing'].includes(sync?.phase ?? '');
  const active = repository?.active;
  return <><div className="repository-tabs" role="group" aria-label="Repository views"><button aria-pressed={tab === 'repository'} onClick={() => setTab('repository')}>Repository</button><button aria-pressed={tab === 'graph'} onClick={() => setTab('graph')}>Knowledge Graph</button></div>
    <div hidden={tab !== 'graph'}>{tab === 'graph' && <KnowledgeGraph sync={sync} active={visible} />}</div>
    <section hidden={tab !== 'repository'} className="panel repo-panel" aria-labelledby="repo-title">
    <div className="panel-heading"><div><span className="section-number">01 / REPOSITORY</span><h2 id="repo-title">{repository?.name ?? 'Connect your repository'}</h2></div><span className={`status ${sync?.phase === 'ready' ? 'ready' : ''}`} data-testid="sync-phase">{sync?.phase ?? 'idle'}</span></div>
    <div className="workspace-folder">
      <label>Workspace folder</label><p className="mono workspace-path">{sync?.workspaceFolder ?? 'Not selected — existing app storage is used'}</p>
      <div className="actions"><button disabled={busy || working || !sync} onClick={() => void act(() => window.desktop.chooseWorkspace())}>Choose workspace folder</button><button disabled={!sync?.workspaceFolder || busy} onClick={() => void act(() => window.desktop.openWorkspace())}>Open workspace folder</button></div>
      {repository?.workspacePath && <><p className="repo-hint">Repository workspace: <span className="mono">{repository.workspacePath}</span></p><p className="repo-hint">Source: <span className="mono">{repository.sourceFolder ?? 'Available after sync'}</span><br />Markdown: <span className="mono">{repository.workspacePath}/docs/README.md</span></p><button className="text-button" disabled={busy || working} onClick={() => void act(() => window.desktop.exportDocs(), 'Published Markdown documentation exported.')}>Export published Markdown</button></>}
      <p className="repo-hint">Clones and Markdown are saved here. Each commit/generation keeps its own version; personal notes belong in notes/.</p>
    </div>
    {repository ? <>
      <p><span className="mono">{repository.branch || 'Resolving branch…'}</span> · {repository.kind === 'remote' ? 'Remote clone' : 'Local repository'} · Read-only source</p>
      <div className="facts"><div><span>PUBLISHED COMMIT</span><strong className="mono" data-testid="active-commit">{active?.commit.slice(0, 8) ?? 'No published snapshot'}</strong></div><div><span>COMMITTED FILES</span><strong>{active?.files ?? '—'}</strong></div><div><span>LAST CHECKED</span><strong>{repository.lastChecked ? new Date(repository.lastChecked).toLocaleTimeString() : 'Not yet'}</strong></div></div>
      {working && <div className="sync-progress" role="status"><span>{sync?.phase === 'cloning' ? (repository.workspacePath ? 'Cloning into the selected workspace…' : 'Cloning into private app storage…') : sync?.phase === 'checking' ? 'Checking the tracked branch…' : `Indexing committed files: ${sync?.processed} / ${sync?.total}`}</span>{sync?.phase === 'indexing' && <progress max={Math.max(sync.total, 1)} value={sync.processed} />}<small>{active ? 'The published snapshot stays available until the update is ready.' : 'Your first snapshot is being prepared.'}</small></div>}
      {active && <><div className="coverage"><span>{active.parsed} parsed</span><span>{active.documentOnly} document-only</span><span>{active.unsupported} unsupported</span><span>{active.excluded} excluded</span><span>{active.failed} failed</span></div><p className="repo-summary">Latest update: {active.added} added · {active.modified} modified · {active.renamed} renamed · {active.deleted} deleted. {active.reused} unchanged file records reused.</p></>}
      <label className="toggle"><input type="checkbox" checked={autoPending ?? repository.autoSync} disabled={busy} onChange={event => {
        const enabled = event.target.checked; setAutoPending(enabled);
        void act(() => window.desktop.setAutoSync(enabled)).finally(() => setAutoPending(null));
      }} /> Check for new commits every 60 seconds</label>
      {active?.analyzer.endsWith('/source-only') && <p className="repo-hint">Structural analysis is unavailable in this runtime. Committed source is still captured; coverage is marked explicitly.</p>}
      <div className="actions"><button className="primary" disabled={busy || working} onClick={() => void act(() => window.desktop.syncRepository())}>{sync?.phase === 'error' || sync?.phase === 'cancelled' ? 'Retry sync' : 'Sync now'}</button>{working && <button disabled={busy} onClick={() => void act(() => window.desktop.cancelSync())}>Cancel sync</button>}<button className="quiet" disabled={busy || working} onClick={() => void act(() => window.desktop.disconnectRepository())}>Disconnect</button></div>
      <p className="repo-hint">Only committed changes are captured. Closing the app stops sync; it resumes on the next launch when enabled.</p>
    </> : <>
      <p>Choose a workspace folder before cloning. Connect a local Git repository or clone a remote. Choose a branch to keep its committed source up to date.</p>
      <div className="mode-switch" role="group" aria-label="Repository source"><button aria-pressed={mode === 'local'} onClick={() => setMode('local')}>Local repository</button><button aria-pressed={mode === 'remote'} onClick={() => setMode('remote')}>Clone remote</button></div>
      <form onSubmit={event => { event.preventDefault(); void act(() => mode === 'local' ? window.desktop.connectLocal(branch) : window.desktop.cloneRepository(url, branch)); }}>
        {mode === 'remote' && <><label htmlFor="remote-url">Repository URL</label><input id="remote-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" maxLength={2048} required autoComplete="off" spellCheck={false} /><p className="repo-hint">HTTPS or SSH. Uses your existing Git credentials. Do not put tokens in the URL.</p></>}
        <label htmlFor="branch">Branch <span className="muted">(optional)</span></label><input id="branch" value={branch} onChange={event => setBranch(event.target.value)} placeholder={mode === 'local' ? 'Current local branch' : 'Remote default branch'} maxLength={200} spellCheck={false} />
        <div className="actions"><button className="primary" disabled={busy || !sync || (mode === 'remote' && !sync.workspaceFolder)} type="submit">{mode === 'local' ? 'Choose repository folder' : 'Clone and connect'}</button></div>
      </form>
    </>}
    {sync?.error && <div role="alert" className="error">{sync.error}</div>}
  </section></>;
}
