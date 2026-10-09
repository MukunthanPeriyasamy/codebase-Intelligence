import { useEffect, useState } from 'react';
import { ModelPicker } from './ModelPicker';
import type { Result } from '../shared/contracts';
import { defaultDocSettings, type DocStatus } from '../shared/documentation';

export function GenerationSettings({ docs, chatRunning, act }: { docs?: DocStatus; chatRunning?: boolean; act: (action: () => Promise<Result>, success?: string) => Promise<void> }) {
  const [settings, setSettings] = useState(defaultDocSettings);
  const running = docs?.phase === 'planning' || docs?.phase === 'generating';
  useEffect(() => { if (docs) setSettings(docs.settings); }, [docs?.settings.embeddingModel, docs?.settings.model, docs?.settings.autoGenerate, docs?.settings.requestsPerRun, docs?.settings.requestsPerDay, docs?.settings.maxOutputTokens]);
  return <section className="panel" aria-labelledby="generation-settings-title"><div className="panel-heading"><div><span className="section-number">MODEL & LIMITS</span><h2 id="generation-settings-title">Generation settings</h2></div></div>
    <form onSubmit={event => { event.preventDefault(); void act(() => window.desktop.configureDocs(settings), 'Generation settings saved.'); }}>
      <fieldset disabled={running || chatRunning || !docs} className="doc-settings">
        <ModelPicker kind="chat" value={settings.model} onChange={model => setSettings({ ...settings, model })} />
        <p>Saved output limit: <strong>{docs?.settings.maxOutputTokens ?? 8000}</strong> tokens per request. Draft changes apply only after Save generation settings.</p>
        <ModelPicker kind="embedding" value={settings.embeddingModel ?? ''} onChange={embeddingModel => setSettings({ ...settings, embeddingModel })} />
        <p className="muted">Embedding selection is saved for document indexing. Vector indexing is not active yet; saving this setting sends no embedding requests.</p>
        <div className="doc-limits">
          <label>Requests per run<input type="number" min={1} max={20} value={settings.requestsPerRun} onChange={event => setSettings({ ...settings, requestsPerRun: Number(event.target.value) })} required /></label>
          <label>Requests per day (UTC)<input type="number" min={1} max={200} value={settings.requestsPerDay} onChange={event => setSettings({ ...settings, requestsPerDay: Number(event.target.value) })} required /></label>
          <label>Output tokens per request<input type="number" min={512} max={16384} value={settings.maxOutputTokens} onChange={event => setSettings({ ...settings, maxOutputTokens: Number(event.target.value) })} required /></label>
        </div>
        <label className="auto-sync"><input type="checkbox" checked={settings.autoGenerate} onChange={event => setSettings({ ...settings, autoGenerate: event.target.checked })} /> Automatically generate on future commits (uses local compute)</label>
        <button type="submit">Save generation settings</button>
      </fieldset>
    </form>
    <p className="muted">Generation uses local Ollama with a 32K context and up to 10 minutes per request. Limits control local work; no provider API charges. Save changed limits before generating.</p>
  </section>;
}
