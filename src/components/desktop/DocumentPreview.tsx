'use client';
import { useState } from 'react';
import Markdown from '@/components/Markdown';
import type { DesktopWorkspace } from '@/types/desktop';

type Page = { title: string; content: string };
type Document = { title: string; pages: Page[]; index?: { status: string; chunk_count: number; embedding_model: string; session_id: string } };
const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();

export default function DocumentPreview({ workspace, language }: { workspace: DesktopWorkspace; language: string }) {
  const [document, setDocument] = useState<Document | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function load() {
    setBusy(true); setMessage(''); setDocument(null);
    try {
      const query = new URLSearchParams({ owner: 'local', repo: workspace.name, repo_type: 'local', language });
      const response = await fetch(`/api/wiki_cache?${query}`);
      if (!response.ok) throw new Error(`Could not load documentation (${response.status})`);
      const cache = await response.json();
      if (!cache) throw new Error('No document Found Generate One');
      const source = cache.repo?.localPath || cache.repo?.repoUrl || cache.repo_url;
      if (!source || normalize(source) !== normalize(workspace.root)) throw new Error('Cached documentation belongs to a different directory. Generate documentation for this workspace.');
      const pages = Object.values(cache.generated_pages || {}).filter((page): page is Page => !!page && typeof (page as Page).content === 'string');
      if (!pages.length) throw new Error('No document Found Generate One');
      setDocument({ title: cache.wiki_structure?.title || workspace.name, pages, index: cache.document_index }); setSelected(0);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    if (!document || !window.desktop) return;
    setBusy(true); setMessage('');
    try {
      const text = `# ${document.title}\n\nWorkspace: ${workspace.root}\n\nLanguage: ${language}\n\nExported: ${new Date().toISOString()}\n\n` + document.pages.map(page => `## ${page.title}\n\n${page.content}`).join('\n\n---\n\n');
      const result = await window.desktop.exportDocument({ workspace: workspace.root, text });
      setMessage(`Saved ${result.relative} in the workspace. Refresh the explorer to open it.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <section aria-label="Document preview" className="document-preview">
    <div className="generation-action"><button disabled={busy} onClick={() => void load()}>{busy ? 'Working…' : 'Preview saved documentation'}</button>{document && <button disabled={busy} onClick={() => void save()}>Save Markdown to workspace</button>}</div>
    {message && <p role="status" className="settings-notice">{message}</p>}
    {document && <>
      <p className="settings-help">{document.index?.status === 'ready' ? `RAG index recorded: ${document.index.chunk_count} chunks · ${document.index.embedding_model}. Chat uses this persistent index; this export is a reference copy.` : 'No ready RAG index is recorded. Regenerate documentation to index it for chat.'}</p>
      <label>Preview page<select value={selected} onChange={event => setSelected(Number(event.target.value))}>{document.pages.map((page, index) => <option key={index} value={index}>{page.title}</option>)}</select></label>
      <article className="document-preview-body"><Markdown content={document.pages[selected].content} allowHtml={false} /></article>
    </>}
  </section>;
}
