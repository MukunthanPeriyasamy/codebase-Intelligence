import { spawn } from 'node:child_process';
import { childEnvironment, RepoError } from './git';
import { snapshotEventSchema, type Snapshot } from '../shared/repository';
import { stopOwnedProcess } from './processes';

export interface SnapshotRequest { mirror: string; stage: string; previous: string | null; commit: string; base: string | null }
export function buildSnapshot(python: string, script: string, request: SnapshotRequest, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-u', script], { windowsHide: true, detached: process.platform !== 'win32', shell: false, env: childEnvironment(), stdio: 'pipe' });
    let buffer = ''; let result: Snapshot | null = null; let failure: Error | null = null;
    const stop = (message: string) => { failure = new RepoError(message); stopOwnedProcess(child); };
    const abort = () => stop('Sync cancelled. Retry to resume the captured commit.');
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('Snapshot indexing reached its 15-minute limit. Retry to resume saved progress.'), 15 * 60 * 1000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 65536) { stop('The snapshot worker exceeded its message limit.'); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const event = snapshotEventSchema.parse(JSON.parse(line));
          if (result) throw new Error('Event after completion');
          if (event.type === 'progress') progress(event.processed, event.total);
          else if (event.type === 'complete') result = event.snapshot;
          else {
            const messages = { GIT: 'Committed source could not be read. Retry repository sync.', STORAGE: 'Snapshot storage could not be read or written. Check disk space and access.', LIMIT: 'Repository exceeds snapshot limits (100,000 files or 512 MiB of eligible source).', RUNTIME: 'Snapshot indexing requires Python 3.12.', INVALID: 'Snapshot validation failed. The previous version remains active.' };
            stop(messages[event.code]);
          }
        } catch { stop('The snapshot worker sent an invalid response. The previous version remains active.'); return; }
      }
    });
    child.stderr.resume();
    child.stdin.on('error', () => { failure ??= new RepoError('The snapshot worker connection closed. Retry to resume.'); });
    child.on('error', () => { failure = new RepoError('Snapshot worker could not start. Check the configured Python runtime.'); });
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0 || !result || result.commit !== request.commit) reject(new RepoError('Snapshot indexing was interrupted. Retry to resume saved progress.'));
      else resolve(result);
    });
    child.stdin.end(JSON.stringify({ v: 1, ...request }) + '\n');
    if (signal.aborted) abort();
  });
}
