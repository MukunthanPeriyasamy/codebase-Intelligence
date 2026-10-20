'use client';

export interface Proposal {
  id: string;
  summary: string;
  root: string;
  status: 'pending' | 'accepted' | 'rejected';
  source_blocks?: { path: string; start_line: number; end_line: number; code: string }[];
  graph?: { status: string; warnings: string[]; traces: { anchor: string; symbol: string; relationship: string; files: string[] }[] };
  files: { path: string; before: string | null; after: string | null; diff: string }[];
  documents?: { page_id: string; title: string; chunk: number; files: string[]; areas?: string[] }[];
}

export async function reviewRequest(action: string, proposal_id?: string, request?: unknown): Promise<Proposal> {
  const response = await fetch('/api/chat/changes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DeepWiki-Review': '1' },
    body: JSON.stringify({ action, proposal_id, request }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Review request failed');
  return data;
}

export default function ChangeReview({ proposal, busy, error, onDecision, onClose }: {
  proposal: Proposal | null; busy: boolean; error: string;
  onDecision: (action: 'accept' | 'reject') => void; onClose: () => void;
}) {
  return <aside aria-label="Proposed code changes" className="flex flex-col min-w-0 h-full border-l border-[var(--border-color)] bg-[var(--card-bg)]">
    <header className="p-4 border-b border-[var(--border-color)] flex justify-between gap-2">
      <div><h2 className="font-semibold">Review changes</h2><p className="text-xs opacity-70">Files change only when you accept.</p></div>
      <button type="button" onClick={onClose} disabled={busy} aria-label="Close diff panel" className="px-2">×</button>
    </header>
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {busy && !proposal && <p role="status">Retrieving documentation → tracing KG relationships → checking current source → preparing your diff…</p>}
      {proposal && <>
        <p className="text-sm whitespace-pre-wrap">{proposal.summary}</p>
        <p className="text-xs break-all">Apply to: <code>{proposal.root}</code></p>
        <p className="text-xs">{proposal.files.length} file(s) · {proposal.status}</p>
        {!!proposal.source_blocks?.length && <details className="text-xs"><summary>Located code blocks ({proposal.source_blocks.length})</summary>{proposal.source_blocks.map((block, i) => <section key={i}><p>{block.path}:{block.start_line}-{block.end_line}</p><pre className="overflow-auto p-2">{block.code}</pre></section>)}</details>}
        {proposal.graph && <details className="text-xs"><summary>Knowledge graph · {proposal.graph.status}</summary>{proposal.graph.warnings.map((warning, i) => <p key={i}>{warning}</p>)}{proposal.graph.traces.map((trace, i) => <p key={i}>{trace.anchor} · {trace.symbol} · {trace.relationship}: {trace.files.join(', ') || 'No usable source paths'}</p>)}</details>}
        {proposal.documents && proposal.documents.length > 0 && <details className="text-xs"><summary>Documentation used ({proposal.documents.length} chunks)</summary><ul className="mt-2 space-y-1">{proposal.documents.map((doc, i) => <li key={i}>{doc.title} · chunk {doc.chunk}{doc.areas?.length ? ` · ${doc.areas.join(', ')}` : ''}<br /><span className="opacity-70">{doc.files.join(', ')}</span></li>)}</ul></details>}
        {proposal.files.map(file => <section key={file.path} className="border border-[var(--border-color)] rounded overflow-hidden">
          <h3 className="text-sm font-mono p-2 break-all">{file.path} · {file.before === null ? 'New file' : file.after === null ? 'Deleted file' : 'Modified file'}</h3>
          <pre className="text-xs overflow-x-auto p-2" aria-label={`Diff for ${file.path}`}>
            {file.diff.split('\n').map((line, i) => <div key={i} className={line.startsWith('+') ? 'bg-green-500/15 text-green-700 dark:text-green-300' : line.startsWith('-') ? 'bg-red-500/15 text-red-700 dark:text-red-300' : ''}>{line || ' '}</div>)}
          </pre>
        </section>)}
      </>}
      {!proposal && !busy && !error && <p className="text-sm">Choose Edit code and describe the change you want.</p>}
      {error && <p role="alert" className="text-sm text-red-600 whitespace-pre-wrap">{error}</p>}
      {error === 'No document Found Generate One' && <p className="text-sm">Generate a wiki for this repository first, then retry. No source lookup or changes were made.</p>}
    </div>
    <footer className="p-4 border-t border-[var(--border-color)] space-y-2">
      {proposal?.status === 'accepted' && <p className="text-xs">Changes applied locally. Regenerate the wiki to refresh its documentation. No tests were run automatically.</p>}
      {proposal?.status === 'rejected' && <p className="text-xs">Proposal rejected. Your original code was left unchanged.</p>}
      <div className="flex justify-end gap-3">
        <button type="button" disabled={busy || proposal?.status !== 'pending'} onClick={() => onDecision('reject')} className="rounded border px-4 py-2 disabled:opacity-40">Reject</button>
        <button type="button" disabled={busy || proposal?.status !== 'pending'} onClick={() => onDecision('accept')} className="rounded bg-[var(--accent-primary)] text-white px-4 py-2 disabled:opacity-40">Accept</button>
      </div>
    </footer>
  </aside>;
}
