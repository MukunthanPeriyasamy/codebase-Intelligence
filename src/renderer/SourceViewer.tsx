import { useEffect, useRef, useState } from 'react';
import type { Evidence } from '../shared/documentation';

export interface SourceSelection { evidence: Evidence; commit: string; origin: 'documentation' | 'chat' }
export function SourceViewer({ source, activeCommit, onClose }: { source: SourceSelection; activeCommit?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [wrap, setWrap] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="source-dialog" aria-labelledby="source-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="source-toolbar"><div><span className="section-number">CAPTURED SOURCE · READ ONLY</span><h2 id="source-title">{source.evidence.path}</h2></div><button autoFocus aria-label="Close source viewer" onClick={onClose}>×</button></div>
    <div className="source-meta"><span>Commit <code>{source.commit.slice(0, 12)}</code> · Lines {source.evidence.start}–{source.evidence.end}{source.commit !== activeCommit && <strong className="stale"> · Older commit</strong>}</span><label className="toggle"><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)} /> Wrap lines</label></div>
    <section className={`source-view ${wrap ? 'wrap-source' : ''}`} aria-label={source.origin === 'chat' ? 'Chat citation source' : 'Citation source'}><pre>{source.evidence.text.split('\n').map((line, i) => <span className="source-line" key={i}><span className="line-number" aria-hidden="true">{source.evidence.start + i}</span><span>{line || ' '}</span>{'\n'}</span>)}</pre></section>
    <p className="muted">Source is pinned to the cited commit. Press Escape to return.</p>
  </dialog>;
}
