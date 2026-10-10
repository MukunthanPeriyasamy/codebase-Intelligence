import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { workerEventSchema, type Failure, type WorkerStatus } from '../shared/contracts';

export interface WorkerOptions { python: string; script: string; dataDir: string; startupMs?: number; heartbeatMs?: number; responseMs?: number }
export class WorkerService {
  status: WorkerStatus = { state: 'stopped', python: null, storageReady: false, error: null };
  private child: ChildProcessWithoutNullStreams | null = null;
  private timer?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private awaitingPong: string | null = null;
  private busy = false;
  private transition: Promise<void> = Promise.resolve();
  constructor(private readonly options: WorkerOptions, private readonly changed: () => void) {}

  private set(state: WorkerStatus['state'], error: Failure | null = null, python: string | null = null) {
    this.status = { state, error, python, storageReady: state === 'ready' };
    this.changed();
  }
  private clearTimers() { clearTimeout(this.timer); clearInterval(this.heartbeat); this.awaitingPong = null; }
  private fail(code: Failure['code'], message: string) {
    this.clearTimers();
    this.set('error', { code, message });
    this.child?.kill();
  }
  async restart(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    const operation = this.transition.then(async () => { await this.stopInternal(); this.launch(); });
    this.transition = operation.catch(() => {});
    try { await operation; return true; }
    finally { this.busy = false; }
  }
  private launch() {
    this.set('starting');
    // The service receives only runtime essentials, never inherited provider keys.
    const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', DO_NOT_TRACK: '1' };
    for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    const child = spawn(this.options.python, ['-I', '-u', this.options.script, '--data-dir', this.options.dataDir], { shell: false, windowsHide: true, env, stdio: 'pipe' });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child || !['starting', 'ready'].includes(this.status.state)) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 65536) { this.fail('WORKER_PROTOCOL', 'The worker exceeded its message limit. Restart the service.'); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const event = workerEventSchema.parse(JSON.parse(line));
          if (event.type === 'ready' && this.status.state === 'starting') {
            clearTimeout(this.timer);
            this.set('ready', null, event.python);
            this.heartbeat = setInterval(() => this.ping(), this.options.heartbeatMs ?? 10000);
          } else if (event.type === 'pong' && this.status.state === 'ready' && event.id === this.awaitingPong) {
            clearTimeout(this.timer); this.awaitingPong = null;
          } else if (event.type === 'error') {
            const messages = { RUNTIME_VERSION: 'Python 3.12 or 3.14 is required. Set CODEBASE_INTELLIGENCE_PYTHON and relaunch.', STORAGE_INIT: 'Local storage could not be opened. Check disk access and restart.', REQUEST_INVALID: 'The worker rejected a request. Restart the service.' };
            this.fail(event.code, messages[event.code]); return;
          } else { throw new Error('Unexpected event'); }
        } catch { this.fail('WORKER_PROTOCOL', 'The worker sent an invalid response. Restart the service.'); return; }
      }
    });
    // Drain stderr but never forward arbitrary worker output or source into UI/logs.
    child.stderr.resume();
    child.stdin.on('error', () => { if (this.status.state === 'ready') this.fail('WORKER_EXIT', 'The worker connection closed. Restart the service.'); });
    child.on('error', () => this.fail('WORKER_START', 'Python could not start. Set CODEBASE_INTELLIGENCE_PYTHON to a Python 3.12 or 3.14 executable and relaunch.'));
    child.on('close', () => {
      if (this.child !== child) return;
      this.child = null; this.clearTimers();
      if (this.status.state === 'stopping') this.set('stopped');
      else if (this.status.state !== 'error') this.set('error', { code: 'WORKER_EXIT', message: 'The worker exited unexpectedly. Restart the service.' });
    });
    this.timer = setTimeout(() => this.fail('WORKER_TIMEOUT', 'Worker startup timed out. Check Python and local storage, then restart.'), this.options.startupMs ?? 15000);
  }
  private ping() {
    if (!this.child || this.awaitingPong || this.status.state !== 'ready') return;
    this.awaitingPong = randomUUID();
    this.child.stdin.write(JSON.stringify({ v: 1, type: 'ping', id: this.awaitingPong }) + '\n');
    this.timer = setTimeout(() => this.fail('WORKER_TIMEOUT', 'The worker stopped responding. Restart the service.'), this.options.responseMs ?? 5000);
  }
  stop(): Promise<void> {
    const operation = this.transition.then(() => this.stopInternal());
    this.transition = operation.catch(() => {});
    return operation;
  }
  private async stopInternal(): Promise<void> {
    this.clearTimers();
    const child = this.child;
    if (!child) { this.set('stopped'); return; }
    this.set('stopping');
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill(), 2000);
      child.once('close', () => { clearTimeout(force); resolve(); });
      child.stdin.end(JSON.stringify({ v: 1, type: 'shutdown' }) + '\n');
    });
  }
}
