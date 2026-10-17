import type { WikiTaskStatusDto } from '@/utils/wikiTask';

const pendingStages = ['Queued', 'Prepare repository and index', 'Read repository inventory', 'Detect application profiles', 'Extract source references', 'Plan documentation structure', 'Generate documentation pages', 'Validate coverage', 'Chunk documents', 'Embed document chunks', 'Verify vector store', 'Save documentation and search schema'].map((label, index) => ({ id: String(index), label, state: 'pending' as const, detail: '' }));

export default function WikiPipelineProgress({ progress: supplied }: { progress: WikiTaskStatusDto | null }) {
  const progress = supplied ?? { status: 'pending', pipeline: pendingStages, pages_total: 0, pages_done: 0, error: null };
  const stages: NonNullable<WikiTaskStatusDto['pipeline']> = progress.pipeline ?? [];
  if (!stages.length) return null;
  const finished = stages.filter(stage => stage.state === 'completed').length;
  const terminal = progress.status === 'completed' || progress.status === 'failed';
  return (
    <details open={progress.status !== 'completed'} className="w-full mb-5 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">
        Document generation · {progress.status === 'failed' ? 'Failed' : progress.status === 'completed' ? 'Completed' : `${finished} of ${stages.length} stages completed`}
      </summary>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Document generation pipeline">
        {stages.map(stage => (
          <li key={stage.id} aria-current={stage.state === 'active' ? 'step' : undefined} className="rounded border border-[var(--border-color)] p-3 text-sm">
            <div className={stage.state === 'failed' ? 'text-red-500' : stage.state === 'pending' ? 'text-[var(--muted)]' : 'text-[var(--accent-primary)]'}>
              <span aria-hidden="true">{stage.state === 'completed' ? '✓' : stage.state === 'failed' ? '✕' : stage.state === 'active' ? '●' : '○'} </span>
              {stage.label}
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {stage.state === 'pending' && progress.status === 'failed' ? 'Not reached' : stage.state}
              {stage.started_at && stage.finished_at ? ` · ${Math.max(0, (stage.finished_at - stage.started_at) / 1000).toFixed(1)}s` : ''}
            </div>
            {stage.detail && <p className="mt-1 break-words text-xs text-[var(--muted)]">{stage.detail}</p>}
            {stage.id === 'pages' && progress.pages_total > 0 && <p className="mt-1 text-xs text-[var(--muted)]">{progress.pages_done} / {progress.pages_total} pages processed</p>}
          </li>
        ))}
      </ol>
      <p role="status" className="mt-3 text-xs text-[var(--muted)]">{terminal ? (progress.error || 'Documentation saved successfully.') : (stages.find(stage => stage.state === 'active')?.label || 'Waiting for a generation worker…')}</p>
    </details>
  );
}
