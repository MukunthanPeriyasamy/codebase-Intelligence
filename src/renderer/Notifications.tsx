import { useEffect, useRef, useState } from 'react';
import type { Result } from '../shared/contracts';
import type { RepositoryStatus } from '../shared/repository';

export function Notifications({ notices, act }: { notices: RepositoryStatus['notices']; act: (action: () => Promise<Result>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const unread = notices.filter(notice => !notice.read).length;
  const close = () => { setOpen(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return <>
    <button ref={button} className="notification-button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} aria-controls="notification-panel" onClick={() => setOpen(value => !value)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg>
      {unread > 0 && <span className="notification-count">{unread}</span>}
    </button>
    <span className="sr-only" role="status">{notices[0] ? `${notices[0].title}. ${notices[0].body}` : ''}</span>
    {open && <aside id="notification-panel" className="notification-panel" role="dialog" aria-label="Notifications">
      <div className="notification-heading"><div><span className="section-number">REPOSITORY ACTIVITY</span><h2>Notifications</h2></div><button autoFocus className="quiet" aria-label="Close notifications" onClick={close}>×</button></div>
      <div className="notification-tools"><span>{unread} unread</span><button className="text-button" disabled={!unread} onClick={() => void act(() => window.desktop.markNoticesRead())}>Mark all as read</button></div>
      {notices.length === 0 ? <div className="notification-empty"><h3>All quiet for now</h3><p>New commits, completed updates and sync failures will appear here.</p></div> : <ol className="notice-list">{notices.map(notice => <li key={notice.id} className={`notice-item ${notice.read ? '' : 'unread'} ${notice.kind}`}><div className="notice-meta"><span>{notice.kind === 'success' ? 'Updated' : notice.kind === 'error' ? 'Needs attention' : 'Repository'}</span><time dateTime={notice.time}>{new Date(notice.time).toLocaleString()}</time></div><h3>{notice.title}</h3><p>{notice.body}</p></li>)}</ol>}
    </aside>}
  </>;
}
