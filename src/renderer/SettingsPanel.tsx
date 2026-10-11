import type { DesktopStatus, Result } from '../shared/contracts';
import { OpenRouterAccess } from './OpenRouterAccess';
import { GenerationSettings } from './GenerationSettings';

export function SettingsPanel({ status, busy, active, act }: { status: DesktopStatus | null; busy: boolean; active: boolean; act: (action: () => Promise<Result>, success?: string) => Promise<void> }) {
  const worker = status?.worker;
  const pending = busy || worker?.state === 'starting' || worker?.state === 'stopping';
  return <div className="settings-layout">
    <nav className="settings-index" aria-label="Settings sections"><strong>Preferences</strong>{[['generation-settings-title', 'Models & limits'], ['model-title', 'Ollama connection'], ['remote-settings', 'OpenRouter access'], ['service-title', 'Analysis engine']].map(([id, title]) => <button key={id} onClick={() => document.getElementById(id!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{title}</button>)}</nav>
    <div className="settings-sections">
    <GenerationSettings docs={status?.docs} chatRunning={status?.chat.phase === 'retrieving' || status?.chat.phase === 'answering'} act={act} />
        <section className="panel" aria-labelledby="model-title">
          <div className="panel-heading"><div><span className="section-number">03 / LOCAL MODEL ACCESS</span><h2 id="model-title">Connect Ollama</h2></div><span className="status" data-testid="ollama-state">{status?.ollama.connected ? 'Connected' : 'Not checked'}</span></div>
          <p>Local server: <code>http://127.0.0.1:11434</code>. No API key required. Install Ollama, then download a model in your terminal:</p>
          <pre>ollama pull qwen2.5-coder:14b</pre>
          <p>Start the Ollama application or run <code>ollama serve</code>. Use a smaller model if memory is limited. Cloud models are excluded.</p>
          <button disabled={busy || !status} onClick={() => void act(() => window.desktop.testOllama(), 'Ollama connected. Refresh models below to select an installed model.')}>Test Ollama connection</button>
          {status?.ollama.error && <p className="error" role="alert">{status.ollama.error}</p>}
        </section>
    <div id="remote-settings"><OpenRouterAccess status={status} busy={busy} active={active} act={act} /></div>
        <section className="panel" aria-labelledby="service-title">
          <div className="panel-heading"><div><span className="section-number">02 / LOCAL ENGINE</span><h2 id="service-title">Analysis service</h2></div><span className={`status ${worker?.state ?? 'starting'}`} data-testid="worker-state">{worker?.state ?? 'connecting'}</span></div>
          <p>The Python worker runs separately, keeping your workspace responsive during analysis.</p>
          <div className="facts"><div><span>RUNTIME</span><strong>{worker?.python ? `Python ${worker.python}` : 'Python 3.12 / 3.14 required'}</strong></div><div><span>LOCAL STORAGE</span><strong>{worker?.storageReady ? 'SQLite · Ready' : 'Waiting for service'}</strong></div></div>
          {worker?.error && <div role="alert" className="error">{worker.error.message}</div>}
          <div className="actions"><button disabled={pending || !status} onClick={() => void act(() => window.desktop.restartWorker())}>{worker?.state === 'ready' ? 'Restart service' : 'Start service'}</button><button className="quiet" disabled={pending || worker?.state !== 'ready'} onClick={() => void act(() => window.desktop.stopWorker())}>Stop service</button></div>
        </section>

  </div></div>;
}
