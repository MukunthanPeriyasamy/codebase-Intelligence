import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DesktopBridge, DesktopStatus, Result } from '../shared/contracts';
import { DocumentationPanel } from './DocumentationPanel';
import { ChatPanel } from './ChatPanel';
import { RepositoryPanel } from './RepositoryPanel';
import { SettingsPanel } from './SettingsPanel';
import { Notifications } from './Notifications';
import { SourceViewer, type SourceSelection } from './SourceViewer';
import './styles.css';

declare global { interface Window { desktop: DesktopBridge } }
const views = ['Repository', 'Documentation', 'Chat', 'Settings'] as const;
type View = typeof views[number];
const descriptions: Record<View, string> = { Repository: 'Committed source, coverage, and background updates.', Documentation: 'Explore what your code does, with evidence at every step.', Chat: 'Ask a question. Follow the evidence back to source.', Settings: 'Model access, shared request limits, and your local engine.' };
function App() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [view, setView] = useState<View>('Repository');
  const currentView = useRef<View>(view); currentView.current = view;
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(0);
  const [source, setSource] = useState<SourceSelection | null>(null);
  const [draft, setDraft] = useState<{ question: string; sequence: number }>();
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<View, number>>({ Repository: 0, Documentation: 0, Chat: 0, Settings: 0 });
  const accept = (result: Result) => { if (result.ok) { setStatus(result.status); setError(''); } else setError(result.error.message); };
  useEffect(() => {
    if (!window.desktop) { setError('Open this workspace in the desktop application.'); return; }
    const unsubscribe = window.desktop.onStatus(setStatus);
    void window.desktop.status().then(accept);
    return unsubscribe;
  }, []);
  useEffect(() => { setSource(null); setDraft(undefined); }, [status?.sync.repository?.id]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = positions.current[view]; }, [view]);
  function navigate(next: View) { if (scroll.current) positions.current[view] = scroll.current.scrollTop; setView(next); setError(''); setNotice(''); }
  async function act(action: () => Promise<Result>, success = '') {
    setPending(value => value + 1); setNotice('');
    try { const result = await action(); accept(result); if (result.ok) setNotice(success); else if (scroll.current) scroll.current.scrollTop = 0; }
    catch { setError('Desktop services are unavailable. Restart the app.'); if (scroll.current) scroll.current.scrollTop = 0; }
    finally { setPending(value => value - 1); }
  }
  const repository = status?.sync.repository;
  const snapshot = repository?.active;
  const chatRunning = status?.chat.phase === 'retrieving' || status?.chat.phase === 'answering';
  const docsRunning = status?.docs.phase === 'planning' || status?.docs.phase === 'generating';
  const syncRunning = ['cloning', 'checking', 'indexing'].includes(status?.sync.phase ?? '');
  const modelReady = !!status?.docs.settings.model && (status.docs.settings.provider !== 'openrouter' || status.credential.configured);
  const hostError = status?.worker.error?.message || status?.ollama.error;
  function askAbout(question: string) { setDraft({ question, sequence: Date.now() }); navigate('Chat'); }
  function inspectSource(next: SourceSelection) { if (currentView.current === (next.origin === 'chat' ? 'Chat' : 'Documentation')) setSource(next); }
  return <div className="workspace">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">ci</span><span>Codebase<br />Intelligence</span></div>
      <div className="sidebar-label">YOUR WORKSPACE</div>
      <nav className="workspace-nav" aria-label="Workspace">{views.map((item, i) => <button key={item} aria-current={view === item ? 'page' : undefined} onClick={() => navigate(item)}><span className="nav-number" aria-hidden="true">0{i + 1}</span>{item}{(item === 'Chat' && chatRunning || item === 'Documentation' && docsRunning || item === 'Repository' && syncRunning) && <span className="activity-dot" aria-label="Working" />}</button>)}</nav>
      <div className="sidebar-note"><span className="dot" /> Local workspace<p>Read-only source.<br />Knowledge tied to commits.</p></div>
      <div className="sidebar-footer">INTERNAL · MVP <span>0.1</span></div>
    </aside>
    <main>
      <header><div className="workspace-identity"><strong title={repository?.name}>{repository?.name ?? 'No repository connected'}</strong><span>{repository?.branch || 'Connect a Git repository to begin'}</span></div><div className="top-actions"><span className="badge" title={snapshot?.commit}>{snapshot ? `Commit ${snapshot.commit.slice(0, 8)}` : 'Awaiting snapshot'}</span><Notifications notices={status?.sync.notices ?? []} act={act} /></div></header>
      <div className="workspace-status" aria-label="Workspace status"><button onClick={() => navigate('Repository')}>Sync <strong>{status?.sync.phase ?? 'connecting'}</strong>{repository && <span> · {repository.autoSync ? 'Auto on' : 'Paused'}</span>}</button><button onClick={() => navigate('Documentation')}>Docs <strong>{status?.docs.phase ?? 'idle'}</strong>{status?.docs.commit && status.docs.commit !== snapshot?.commit && <span className="stale"> · Older commit</span>}</button><button onClick={() => navigate('Chat')}>Chat <strong>{status?.chat.phase ?? 'idle'}</strong></button><button onClick={() => navigate('Settings')}>Today <strong>{status?.docs.requestsToday ?? 0}/{status?.docs.settings.requestsPerDay ?? 20}</strong> requests</button></div>
      <div className={`content ${view === 'Chat' ? 'chat-content' : ''}`} ref={scroll}>
        <div className="view-heading" hidden={view === 'Chat'}><div className="eyebrow">YOUR CODE. IN CONTEXT.</div><h1>{view}</h1><p className="intro">{descriptions[view]}</p></div>
        {error && <div role="alert" className="error global-message">{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}
        {notice && <p role="status" className="notice global-message">{notice}</p>}
        {view !== 'Settings' && hostError && <div role="alert" className="error global-message">{hostError}<button onClick={() => navigate('Settings')}>Open settings</button></div>}
        <div hidden={view !== 'Repository'} className="workspace-view">
          <RepositoryPanel active={view === 'Repository'} sync={status?.sync} act={act} busy={pending > 0} />
          <section className="panel journey" aria-labelledby="journey-title"><span className="section-number">NEXT STEPS</span><h2 id="journey-title">From source to understanding</h2><div className="journey-grid">
            <button onClick={() => navigate('Settings')}><span className="step-label">01 / MODEL ACCESS</span><strong>{modelReady ? 'Model configured' : 'Choose your model'}</strong><span>{modelReady ? status?.docs.settings.model : 'Choose Ollama or OpenRouter and a model.'}</span></button>
            <button onClick={() => navigate('Documentation')}><span className="step-label">02 / DOCUMENTATION</span><strong>{status?.docs.completed ? `${status.docs.completed} pages available` : 'Build your documentation'}</strong><span>{snapshot ? 'Generate manually, then inspect the citations.' : 'Available after the first snapshot.'}</span></button>
            <button onClick={() => navigate('Chat')}><span className="step-label">03 / EXPLORE</span><strong>Ask your repository</strong><span>Local symbol lookups work without a model key.</span></button>
          </div></section>
        </div>
        <div hidden={view !== 'Documentation'} className="workspace-view"><DocumentationPanel docs={status?.docs} repoId={repository?.id} configured={modelReady} chatRunning={chatRunning} act={act} onSettings={() => navigate('Settings')} onSource={inspectSource} onAsk={askAbout} /></div>
        <div hidden={view !== 'Chat'} className="workspace-view chat-view"><ChatPanel chat={status?.chat} repoId={repository?.id} commit={snapshot?.commit} act={act} onSource={inspectSource} onSettings={() => navigate('Settings')} draft={draft} active={view === 'Chat'} /></div>
        <div hidden={view !== 'Settings'} className="workspace-view"><SettingsPanel status={status} busy={pending > 0} active={view === 'Settings'} act={act} /></div>
        <footer className="view-footer" hidden={view === 'Chat'}>Committed source only · Source checkouts stay unchanged</footer>
      </div>
    </main>
    {source && <SourceViewer source={source} activeCommit={snapshot?.commit} onClose={() => setSource(null)} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
