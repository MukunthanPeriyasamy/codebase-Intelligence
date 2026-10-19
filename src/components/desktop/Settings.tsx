'use client';
import { useEffect, useRef, useState } from 'react';
import { FaCog, FaTimes, FaBookOpen, FaPlay } from 'react-icons/fa';
import EmbeddingModelField from '@/components/EmbeddingModelField';
import WikiPipelineProgress from '@/components/WikiPipelineProgress';
import { getWikiTask, submitWikiTask, type WikiTaskStatusDto } from '@/utils/wikiTask';
import type { DesktopWorkspace } from '@/types/desktop';

export type StudioConfig = { provider: string; model: string; embeddingModel: string; language: string; comprehensive: boolean; excludedDirs: string; excludedFiles: string };
export const defaultStudioConfig: StudioConfig = { provider: 'ollama', model: 'qwen3:8b', embeddingModel: 'nomic-embed-text', language: 'en', comprehensive: true, excludedDirs: '', excludedFiles: '' };
export const studioConfigKey = 'deepwiki-studio-settings-v1';
type Provider = { id: string; name: string; models: { id: string; name: string }[] };

export default function Settings({ open, onClose, workspace, config, onSave }: {
  open: boolean; onClose: () => void; workspace: DesktopWorkspace | null; config: StudioConfig; onSave: (config: StudioConfig) => void;
}) {
  const [draft, setDraft] = useState(config);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [languages, setLanguages] = useState<Record<string, string>>({ en: 'English' });
  const [tab, setTab] = useState<'models' | 'documents'>('models');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [progress, setProgress] = useState<WikiTaskStatusDto | null>(null);
  const [completed, setCompleted] = useState(false);
  const [taskLanguage, setTaskLanguage] = useState(config.language);
  const dialog = useRef<HTMLDialogElement>(null);
  const taskKey = `deepwiki-studio-generation:${workspace?.root || ''}`;
  const running = submitting || !!taskId;

  useEffect(() => { if (open) { setDraft(config); dialog.current?.showModal(); } else dialog.current?.close(); }, [open, config]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([fetch('/api/models/config'), fetch('/api/lang/config'), fetch('/api/auth/status')]).then(async responses => {
      if (responses.some(r => !r.ok)) throw new Error('Could not load settings from the backend. Check that it is running.');
      const [models, langs, auth] = await Promise.all(responses.map(r => r.json()));
      if (active) { setProviders(models.providers || []); setLanguages(langs.supported_languages || { en: 'English' }); setAuthRequired(auth.auth_required); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open]);
  useEffect(() => {
    if (!workspace) return;
    try {
      const saved = JSON.parse(localStorage.getItem(taskKey) || 'null');
      if (saved?.id) { setTaskId(saved.id); setTaskLanguage(saved.language || 'en'); }
    } catch { /* An invalid saved task does not block configuration. */ }
  }, [workspace, taskKey]);
  useEffect(() => {
    if (!taskId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await getWikiTask(taskId);
        if (stopped) return;
        if (!status) { setTaskId(''); localStorage.removeItem(taskKey); setError('This task is no longer available. Check the documentation workspace for saved results.'); return; }
        setProgress(status);
        if (status.status === 'completed' || status.status === 'failed') {
          setCompleted(status.status === 'completed'); setTaskId(''); localStorage.removeItem(taskKey);
          if (status.error) setError(status.error);
          return;
        }
      } catch (e) { if (!stopped) setError((e as Error).message); }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [taskId, taskKey]);

  function save() {
    if (!draft.provider || !draft.model.trim() || !draft.embeddingModel.trim()) throw new Error('Choose a provider and enter both model names.');
    const value = { ...draft, model: draft.model.trim(), embeddingModel: draft.embeddingModel.trim() };
    localStorage.setItem(studioConfigKey, JSON.stringify(value)); onSave(value); setNotice('Settings saved. Chat and future document generation use these models.');
    return value;
  }
  async function generate() {
    if (!workspace || running) return;
    setSubmitting(true); setError(''); setNotice('');
    try {
      const settings = save();
      // Recheck authorization at submission time rather than trusting stale UI state.
      const authResponse = await fetch('/api/auth/status');
      if (!authResponse.ok) throw new Error('Cannot check generation authorization');
      const auth = await authResponse.json(); setAuthRequired(auth.auth_required);
      if (auth.auth_required) {
        const validation = await fetch('/api/auth/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: authCode }) });
        if (!validation.ok || !(await validation.json()).success) throw new Error('Enter a valid application authorization code.');
      }
      const result = await submitWikiTask({ repo_url: workspace.root, owner: 'local', repo: workspace.name, type: 'local',
        provider: settings.provider, model: settings.model, embedding_model: settings.embeddingModel, language: settings.language,
        comprehensive: settings.comprehensive, excluded_dirs: settings.excludedDirs, excluded_files: settings.excludedFiles });
      setTaskLanguage(settings.language); setProgress(null); setCompleted(result.status === 'completed');
      if (result.status === 'completed') { setNotice('Documentation is ready. Open it below.'); }
      else { setTaskId(result.task_id); localStorage.setItem(taskKey, JSON.stringify({ id: result.task_id, language: settings.language })); }
    } catch (e) { setError((e as Error).message); } finally { setSubmitting(false); }
  }
  const params = new URLSearchParams({ type: 'local', local_path: encodeURIComponent(workspace?.root || ''), language: taskLanguage });
  return <dialog ref={dialog} className="studio-settings" aria-labelledby="settings-title" onCancel={onClose}>
    <header><div><FaCog /><h2 id="settings-title">Settings</h2><span>Make this workspace yours.</span></div><button aria-label="Close settings" onClick={onClose}><FaTimes /></button></header>
    <nav aria-label="Settings sections"><button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>Models & intelligence</button><button className={tab === 'documents' ? 'active' : ''} onClick={() => setTab('documents')}>Document generation {running && '•'}</button></nav>
    <div className="settings-content">
      {error && <p className="settings-error" role="alert">{error}</p>}{notice && <p className="settings-notice" role="status">{notice}</p>}
      {tab === 'models' ? <><h3>Model configuration</h3><p className="settings-help">Choose the model used by chat and document generation. Provider credentials and server addresses remain in the backend configuration.</p>
        <div className="settings-grid"><label>Provider<select aria-label="Model provider" value={draft.provider} onChange={e => { const p = providers.find(p => p.id === e.target.value); setDraft(d => ({ ...d, provider: e.target.value, model: p?.models[0]?.id || '' })); }}>
          {!providers.some(p => p.id === draft.provider) && <option value={draft.provider}>{draft.provider}</option>}{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Generation / chat model<input aria-label="Generation model" list="studio-models" value={draft.model} onChange={e => setDraft(d => ({ ...d, model: e.target.value }))} /><datalist id="studio-models">{providers.find(p => p.id === draft.provider)?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist></label></div>
        <p className="settings-help">Select a suggested model or enter a custom model name.</p>
        <EmbeddingModelField value={draft.embeddingModel} onChange={value => setDraft(d => ({ ...d, embeddingModel: value }))} />
        <p className="settings-help">Changing the embedding model affects future generation; existing document indexes keep their original embedding model.</p>
      </> : <><h3>Generate workspace documentation</h3><p className="settings-workspace">{workspace?.root || 'Open a folder in the explorer before generating documents.'}</p>
        <div className="settings-grid"><label>Document language<select aria-label="Document language" value={draft.language} onChange={e => setDraft(d => ({ ...d, language: e.target.value }))}>{Object.entries(languages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>Coverage<select aria-label="Documentation coverage" value={draft.comprehensive ? 'comprehensive' : 'concise'} onChange={e => setDraft(d => ({ ...d, comprehensive: e.target.value === 'comprehensive' }))}><option value="comprehensive">Comprehensive</option><option value="concise">Concise</option></select></label></div>
        <div className="settings-grid"><label>Exclude directories<textarea rows={2} placeholder="One directory per line" value={draft.excludedDirs} onChange={e => setDraft(d => ({ ...d, excludedDirs: e.target.value }))} /></label><label>Exclude files<textarea rows={2} placeholder="One pattern per line" value={draft.excludedFiles} onChange={e => setDraft(d => ({ ...d, excludedFiles: e.target.value }))} /></label></div>
        {authRequired && <label>Authorization code<input type="password" autoComplete="off" value={authCode} onChange={e => setAuthCode(e.target.value)} /></label>}
        <div className="generation-action"><span>{draft.provider} / {draft.model}<small>Embeddings: {draft.embeddingModel} · ChromaDB</small></span><button className="primary" disabled={!workspace || running} onClick={() => void generate()}><FaPlay />{running ? 'Generating…' : 'Generate documentation'}</button></div>
        {(!completed || progress) && <WikiPipelineProgress progress={progress} />}
        {completed && <p className="settings-notice">Documentation and its search index are ready.</p>}
        {workspace && (completed || progress) && <a className="settings-doc-link" href={`/local/${encodeURIComponent(workspace.name)}?${params}`} target="_blank"><FaBookOpen /> Open workspace documentation ↗</a>}
        <p className="settings-help">Generation continues on the backend when this dialog closes. Reopening shows its progress. Existing cached results may be reused.</p>
      </>}
    </div>
    <footer><span>Settings are stored on this device.</span><button onClick={onClose}>Close</button><button className="primary" onClick={() => { try { setError(''); save(); } catch (e) { setError((e as Error).message); } }}>Save settings</button></footer>
  </dialog>;
}
