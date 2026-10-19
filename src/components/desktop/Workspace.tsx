'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import { FaCode, FaFolderOpen, FaFolder, FaRegFileCode, FaChevronRight, FaChevronDown, FaPlus, FaSave, FaSyncAlt, FaTimes, FaSearch, FaComments, FaBookOpen, FaCog } from 'react-icons/fa';
import Settings, { defaultStudioConfig, studioConfigKey, type StudioConfig } from './Settings';
import Ask from '@/components/Ask';
import type { DesktopEntry, DesktopWorkspace, DesktopFile } from '@/types/desktop';
import type { CodeTarget } from '@/components/CodeViewer';
import './workspace.css';

loader.config({ paths: { vs: '/vendor/monaco/vs' } });
type Tab = DesktopFile & { path: string; saved: string };
const language = (name: string) => ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', md: 'markdown', json: 'json', css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', rs: 'rust', go: 'go', dart: 'dart', sh: 'shell', ps1: 'powershell', cs: 'csharp', cpp: 'cpp', java: 'java', sql: 'sql' }[name.split('.').pop() || ''] || 'plaintext');

export default function Workspace() {
  const [workspace, setWorkspace] = useState<DesktopWorkspace | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<StudioConfig>(defaultStudioConfig);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(studioConfigKey) || 'null'); if (saved && typeof saved.provider === 'string' && typeof saved.model === 'string') setConfig({ ...defaultStudioConfig, ...saved }); }
    catch { /* Use defaults if saved settings cannot be read. */ }
  }, []);
  const [entries, setEntries] = useState<Record<string, DesktopEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState('');
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('Open a folder to get started');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [newPath, setNewPath] = useState('');
  const [reviewHost, setReviewHost] = useState<HTMLDivElement | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [location, setLocation] = useState({ line: 1, column: 1 });
  const [sizes, setSizes] = useState({ explorer: 240, chat: 410 });
  const editor = useRef<Parameters<OnMount>[0] | null>(null);
  const state = useRef({ tabs, active, workspace });
  state.current = { tabs, active, workspace };
  const current = tabs.find(tab => tab.path === active);
  const dirty = tabs.some(tab => tab.text !== tab.saved);

  useEffect(() => {
    window.desktop?.setDirty(dirty);
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  const refresh = useCallback(async () => {
    if (!workspace || !window.desktop) return;
    try {
      const loaded = await Promise.all([...expanded].map(async path => [path, await window.desktop!.list({ workspace: workspace.root, relative: path })] as const));
      setEntries(Object.fromEntries(loaded)); setMessage('Explorer refreshed');
    } catch (e) { setError((e as Error).message); }
  }, [workspace, expanded]);

  async function openFolder() {
    if (!window.desktop) { setError('Launch the desktop app with npm start to open local folders.'); return; }
    if (dirty && !confirm('Discard unsaved changes and open another folder?')) return;
    setBusy(true); setError('');
    try {
      const chosen = await window.desktop.chooseFolder();
      if (!chosen) return;
      setWorkspace(chosen); setTabs([]); setActive(''); setExpanded(new Set([''])); setEntries({}); setReviewOpen(false);
      setEntries({ '': await window.desktop.list({ workspace: chosen.root }) });
      setMessage(`Workspace: ${chosen.name}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function openFile(path: string, line?: number | null) {
    if (!workspace || !window.desktop) return;
    try {
      if (!state.current.tabs.some(tab => tab.path === path)) {
        const result = await window.desktop.read({ workspace: workspace.root, relative: path });
        if (state.current.workspace?.root !== workspace.root) return;
        setTabs(previous => previous.some(tab => tab.path === path) ? previous : [...previous, { ...result, saved: result.text, path }]);
      }
      setActive(path); setReviewOpen(false); setError('');
      if (line) setTimeout(() => { editor.current?.revealLineInCenter(line); editor.current?.setPosition({ lineNumber: line, column: 1 }); }, 100);
    } catch (e) { setError((e as Error).message); }
  }

  const save = useCallback(async () => {
    const { workspace, active, tabs } = state.current;
    const tab = tabs.find(t => t.path === active);
    if (!workspace || !tab || !window.desktop) return;
    try {
      const text = editor.current?.getValue() ?? tab.text;
      const result = await window.desktop.save({ workspace: workspace.root, relative: active, text, hash: tab.hash });
      setTabs(previous => previous.map(t => t.path === active ? { ...t, saved: text, hash: result.hash } : t));
      setMessage(`Saved ${active}`); setError('');
    } catch (e) { setError((e as Error).message); }
  }, []);

  async function reload() {
    if (!workspace || !current || !window.desktop) return;
    if (current.text !== current.saved && !confirm('Discard your edits and reload this file from disk?')) return;
    try {
      const result = await window.desktop.read({ workspace: workspace.root, relative: current.path });
      setTabs(previous => previous.map(t => t.path === current.path ? { ...t, ...result, saved: result.text } : t));
      setError(''); setMessage('File reloaded');
    } catch (e) { setError((e as Error).message); }
  }

  async function applied() {
    const { tabs, workspace } = state.current;
    if (!workspace || !window.desktop) return;
    for (const tab of tabs) {
      if (tab.text !== tab.saved) continue;
      try {
        const result = await window.desktop.read({ workspace: workspace.root, relative: tab.path });
        setTabs(previous => previous.map(t => t.path === tab.path && t.text === t.saved ? { ...t, ...result, saved: result.text } : t));
      } catch { /* Deleted files remain available in the editor until closed. */ }
    }
    void refresh(); setMessage('Approved changes applied. Unsaved editor buffers were preserved.');
  }

  async function create(directory: boolean) {
    if (!workspace || !window.desktop) return;
    const relative = newPath.trim();
    if (!relative) return;
    try { await window.desktop.create({ workspace: workspace.root, relative, directory }); setCreating(null); setNewPath(''); await refresh(); if (!directory) await openFile(relative); }
    catch (e) { setError((e as Error).message); }
  }

  function closeTab(tab: Tab) {
    if (tab.text !== tab.saved && !confirm(`Discard unsaved changes to ${tab.path}?`)) return;
    const next = tabs.filter(t => t.path !== tab.path); setTabs(next);
    if (active === tab.path) setActive(next.at(-1)?.path || '');
  }

  function resize(side: 'explorer' | 'chat', start: number) {
    const original = sizes[side];
    const move = (event: PointerEvent) => setSizes(previous => ({ ...previous, [side]: Math.max(side === 'chat' ? 320 : 180, Math.min(side === 'chat' ? 620 : 420, original + (event.clientX - start) * (side === 'chat' ? -1 : 1))) }));
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
  }

  const mount: OnMount = (instance, monaco) => {
    editor.current = instance;
    monaco.editor.defineTheme('studio', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#13161d', 'editorLineNumber.foreground': '#485365', 'editor.lineHighlightBackground': '#1b202b', 'editor.selectionBackground': '#33456a' } });
    monaco.editor.setTheme('studio');
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());
    instance.onDidChangeCursorPosition(event => setLocation({ line: event.position.lineNumber, column: event.position.column }));
  };

  function renderTree(folder = '', depth = 0): React.ReactNode {
    return (entries[folder] || []).filter(entry => entry.directory || !filter || entry.name.toLowerCase().includes(filter.toLowerCase())).map(entry => <div key={entry.path}>
      <button className={`tree-row ${active === entry.path ? 'selected' : ''}`} style={{ paddingLeft: 14 + depth * 15 }}
        onClick={async () => {
          if (!entry.directory) { void openFile(entry.path); return; }
          if (expanded.has(entry.path)) { setExpanded(old => new Set([...old].filter(p => p !== entry.path))); return; }
          try {
            const children = await window.desktop!.list({ workspace: workspace!.root, relative: entry.path });
            setEntries(old => ({ ...old, [entry.path]: children })); setExpanded(old => new Set([...old, entry.path]));
          } catch (e) { setError((e as Error).message); }
        }}>
        {entry.directory ? <>{expanded.has(entry.path) ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}<FaFolder className="folder-icon" /></> : <><span className="tree-indent" /><FaRegFileCode className="file-icon" /></>}
        <span>{entry.name}</span>{tabs.some(t => t.path === entry.path && t.text !== t.saved) && <i className="dirty-dot" />}
      </button>
      {entry.directory && expanded.has(entry.path) && renderTree(entry.path, depth + 1)}
    </div>);
  }

  return <main className="studio" data-theme="dark">
    <header className="studio-header"><div className="studio-brand"><span className="brand-mark"><FaCode /></span> deepwiki<span className="brand-sub">STUDIO</span></div>
      <div className="workspace-location"><FaFolderOpen /><span>{workspace?.root || 'Your next idea starts here'}</span></div>
      <button onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings"><FaCog size={17} /></button></header>
    <div className="studio-body" style={{ gridTemplateColumns: `${sizes.explorer}px 4px minmax(260px, 1fr) 4px ${sizes.chat}px` }}>
      <aside className="explorer"><div className="panel-heading"><span>EXPLORER</span><div><button title="Open folder" aria-label="Open folder" disabled={busy} onClick={openFolder}><FaFolderOpen /></button><button title="New file" aria-label="New file" disabled={!workspace} onClick={() => { setCreating('file'); setNewPath(''); }}><FaPlus /></button><button title="New folder" aria-label="New folder" disabled={!workspace} onClick={() => { setCreating('folder'); setNewPath(''); }}><FaFolder /></button><button title="Refresh files" aria-label="Refresh files" onClick={() => void refresh()}><FaSyncAlt /></button></div></div>
        {creating && <form className="create-entry" onSubmit={e => { e.preventDefault(); void create(creating === 'folder'); }}>
          <label>New {creating}<input autoFocus aria-label="New entry path" placeholder="Path relative to workspace" value={newPath} onChange={e => setNewPath(e.target.value)} /></label>
          <button type="submit">Create</button><button type="button" onClick={() => setCreating(null)}>Cancel</button>
        </form>}
        <label className="file-filter"><FaSearch size={11} /><input placeholder="Filter visible files…" value={filter} onChange={e => setFilter(e.target.value)} /></label>
        <div className="project-label"><FaChevronDown size={9} /> {workspace?.name.toUpperCase() || 'NO FOLDER OPEN'}</div>
        <div className="tree">{workspace ? renderTree() : <div className="explorer-empty">Open a local folder to explore your code.<button className="primary" onClick={openFolder}>Open folder</button></div>}</div>
        <a className="wiki-link" href="/" target="_blank"><FaBookOpen /> Documentation workspace ↗</a>
      </aside>
      <div className="resize-handle" onPointerDown={e => resize('explorer', e.clientX)} />
      <section className="editor-panel" aria-label="Code editor">
        <div className="editor-tabs">{tabs.map(tab => <div key={tab.path} className={`editor-tab ${active === tab.path ? 'active' : ''}`}>
          <button onClick={() => { setActive(tab.path); setReviewOpen(false); }}><FaRegFileCode /><span>{tab.path.split('/').pop()}</span>{tab.text !== tab.saved && <i className="dirty-dot" />}</button>
          <button aria-label={`Close ${tab.path}`} onClick={() => closeTab(tab)}><FaTimes size={10} /></button></div>)}
          <div className="editor-actions"><button aria-label="Reload file" title="Reload from disk" disabled={!current} onClick={() => void reload()}><FaSyncAlt /></button><button aria-label="Save file" title="Save (Ctrl+S)" disabled={!current} onClick={() => void save()}><FaSave /></button></div></div>
        <div className="breadcrumbs">{workspace?.name || 'Workspace'} <FaChevronRight size={8} /> {active || 'Welcome'}<span>{current ? language(current.path) : 'Start building'}</span></div>
        {error && <div className="studio-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        <div className="editor-surface">
          {current ? <Editor path={workspace!.root + '/' + current.path} language={language(current.path)} value={current.text}
            onChange={value => setTabs(previous => previous.map(tab => tab.path === active ? { ...tab, text: value ?? '' } : tab))}
            onMount={mount} theme="studio" loading={<div className="editor-loading">Loading editor…</div>}
            options={{ editContext: false, fontSize: 13, fontFamily: 'Consolas, monospace', minimap: { enabled: false }, padding: { top: 18 }, scrollBeyondLastLine: false, automaticLayout: true, smoothScrolling: true, tabSize: 2, renderLineHighlight: 'all' }} />
          : <div className="welcome"><span className="welcome-icon"><FaCode /></span><p className="eyebrow">YOUR CODE. IN CONTEXT.</p><h1>A clearer view of<br />what you’re building.</h1><p>Explore your files, shape your code, and reason<br />with your codebase—all in one workspace.</p><button className="primary" onClick={openFolder}><FaFolderOpen /> Open a project</button><div className="welcome-hints"><span><kbd>Ctrl S</kbd> Save changes</span><span><kbd>/</kbd> Chat commands</span></div></div>}
          <div ref={setReviewHost} className="review-surface" style={{ display: reviewOpen ? 'block' : 'none' }} />
        </div>
      </section>
      <div className="resize-handle" onPointerDown={e => resize('chat', e.clientX)} />
      <aside className="studio-chat"><div className="panel-heading"><span><FaComments /> CODEBASE CHAT</span><span className="context-badge">{workspace ? 'Workspace connected' : 'No workspace'}</span></div>
        {workspace ? <Ask key={workspace.root} repoInfo={{ owner: 'local', repo: workspace.name, type: 'local', localPath: workspace.root, repoUrl: null, token: null }}
          provider={config.provider} model={config.model} language={config.language} onOpenModelSettings={() => setSettingsOpen(true)}
          reviewHost={reviewHost} onReviewVisibility={setReviewOpen} onChangesApplied={applied}
          onOpenCodeViewer={(target: CodeTarget) => void openFile(target.file_path, target.start_line)} />
        : <div className="chat-empty"><span className="chat-orb"><FaComments /></span><h2>Meet your codebase.</h2><p>Open a project to ask questions,<br />trace relationships, and review edits.</p><div className="sample-prompt">How does this application work?</div><div className="sample-prompt">Find the callers of this function</div><div className="sample-prompt">Help me make a change</div><small>Changes stay proposals until you accept.</small></div>}
      </aside>
    </div>
    <footer className="studio-status"><span><i className="status-dot" /> {message}</span><span>{dirty ? '● Unsaved changes' : 'All changes saved'}<b>Ln {location.line}, Col {location.column}</b><b>UTF-8</b><b>{current ? language(current.path) : 'DeepWiki Studio'}</b></span></footer>
    <Settings key={workspace?.root || 'no-workspace'} open={settingsOpen} onClose={() => setSettingsOpen(false)} workspace={workspace} config={config} onSave={setConfig} />
  </main>;
}
