'use client';

import { useEffect, useState } from 'react';

type Tool = { name: string; description: string; requires_confirmation: boolean;
  inputSchema: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] } };

export async function graphRequest(body: object) {
  const response = await fetch('/api/kg', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DeepWiki-Review': '1' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'KG request failed');
  return data;
}

export default function GraphCommands({ question, onSelect, onClose, selectedWorkspace }: {
  question: string; onSelect: (command: string) => void; onClose: () => void; selectedWorkspace?: string;
}) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Tool | null>(null);
  const [args, setArgs] = useState('{}');
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let active = true;
    graphRequest({ action: 'tools' }).then(data => {
      if (active) { setTools([{ name: 'kg', description: 'Ask a natural-language question using read-only graph tools', requires_confirmation: false,
        inputSchema: { properties: { question: { type: 'string' } }, required: ['question'] } }, ...data.tools]); setWorkspace(selectedWorkspace || data.workspace); }
    }).catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedWorkspace]);
  const filter = question.slice(1).split(/\s/)[0].toLowerCase();
  const visible = tools.filter(t => t.name.toLowerCase().includes(filter));
  const choose = (tool: Tool) => {
    setError('');
    setSelected(tool);
    const values: Record<string, unknown> = {};
    if (selectedWorkspace && tool.inputSchema.properties?.repo_path) values.repo_path = selectedWorkspace;
    for (const name of tool.inputSchema.required || []) {
      const prop = tool.inputSchema.properties?.[name];
      values[name] = name === 'repo_path' ? workspace : prop?.enum?.[0] ??
        (prop?.type === 'boolean' ? false : prop?.type === 'integer' || prop?.type === 'number' ? 1 : prop?.type === 'array' ? [] : prop?.type === 'object' ? {} : '');
    }
    setArgs(JSON.stringify(values, null, 2));
  };
  return <div role="dialog" aria-label="Knowledge graph commands"
    className="mb-2 rounded border border-[var(--border-color)] bg-[var(--background)] p-3 text-sm"
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (selected) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); setIndex(i => Math.max(0, Math.min(visible.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
      }
      if (e.key === 'Enter' && visible[Math.min(index, visible.length - 1)]) {
        e.preventDefault(); choose(visible[Math.min(index, visible.length - 1)]);
      }
    }}>
    <div className="flex justify-between"><strong>KG commands · CodeGraphContext</strong>
      <button type="button" onClick={onClose} aria-label="Close KG commands">×</button></div>
    <p className="text-xs break-all my-2">Graph workspace: {workspace || 'Connecting…'} · Independent KG test session</p>
    {loading && <p role="status">Discovering MCP tools…</p>}
    {error && <p role="alert">{error}</p>}
    {!selected ? <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="Available graph commands">
      {!loading && !error && !visible.length && <p>No matching commands.</p>}
      {visible.map((tool, i) => <button key={tool.name} type="button" role="option" aria-selected={i === index}
        className={`block w-full text-left p-2 rounded ${i === index ? 'bg-purple-600/15' : ''}`}
        onClick={() => choose(tool)}>
        <strong>/{tool.name}</strong>{tool.requires_confirmation && <span> · confirm operation</span>}
        <span className="block text-xs opacity-75">{tool.description}</span>
      </button>)}
    </div> : <div>
      <p className="my-2"><strong>/{selected.name}</strong> — {selected.description}</p>
      <details><summary>Arguments and types</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(selected.inputSchema, null, 2)}</pre></details>
      <label className="block mt-2">Arguments (JSON)
        <textarea value={args} onChange={e => setArgs(e.target.value)} rows={5}
          className="w-full bg-[var(--input-bg)] border rounded p-2 font-mono" /></label>
      <button type="button" className="mr-3" onClick={() => setSelected(null)}>Back</button>
      <button type="button" className="p-2 rounded bg-purple-600 text-white" onClick={() => {
        try {
          const parsed = JSON.parse(args);
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Arguments must be a JSON object');
          onSelect(selected.name === 'kg' ? `/kg ${parsed.question}` : `/${selected.name} ${JSON.stringify(parsed)}`);
        } catch (e) { setError((e as Error).message); }
      }}>Use command</button>
    </div>}
  </div>;
}
