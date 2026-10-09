import { useState } from 'react';
import type { ModelCatalog } from '../shared/models';

export function ModelPicker({ kind, value, onChange }: { kind: 'chat' | 'embedding'; value: string; onChange: (value: string) => void }) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [query, setQuery] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const title = kind === 'chat' ? 'Chat and documentation' : 'Embedding';
  const filtered = catalog?.models.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const selected = catalog?.models.find(model => model.id === value);
  async function refresh() {
    setLoading(true); setError('');
    try {
      const result = await window.desktop.listModels(kind);
      if (!result.ok) setError(result.error.message);
      else if (result.models) setCatalog(result.models);
    } catch { setError('Model list unavailable. Refresh to retry.'); }
    finally { setLoading(false); }
  }
  return <div className="model-picker">
    <div className="panel-heading"><strong>{title} model</strong><button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? 'Loading…' : `Refresh ${kind} models`}</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    <label>Search {kind} models<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search installed models" /></label>
    <label htmlFor={`${kind}-model-list`}>Available {kind} models</label><select id={`${kind}-model-list`} value={filtered.some(model => model.id === value) ? value : ''} onChange={event => { if (event.target.value) onChange(event.target.value); }}>
      <option value="">{catalog ? `Choose from ${filtered.length} matching models` : 'Refresh to load Ollama models'}</option>
      {filtered.map(model => <option key={model.id} value={model.id}>{model.name} — {model.id}{kind === 'chat' && model.structured ? ' · JSON schema' : ''}</option>)}
    </select>
    <label>{kind === 'chat' ? 'Ollama model ID' : 'Ollama embedding model ID'}<input value={value} placeholder="qwen2.5-coder:14b" maxLength={150} onChange={event => onChange(event.target.value)} required={kind === 'chat'} /></label>
    {selected && <p className="muted">Installed locally · {kind === 'chat' ? 'Text completion with JSON schema' : 'Embedding capable'}</p>}
    {catalog && <p className="muted">{catalog.models.length} installed compatible models · Refreshed {new Date(catalog.fetched).toLocaleString()}. Install additional models with ollama pull.</p>}
  </div>;
}
