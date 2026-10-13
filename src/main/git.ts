import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { stopOwnedProcess } from './processes';

export class RepoError extends Error {
  constructor(message: string, readonly transient = false) { super(message); }
}
export function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_OPTIONAL_LOCKS: '0', PYTHONIOENCODING: 'utf-8', DO_NOT_TRACK: '1' };
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'SSH_AUTH_SOCK', 'LANG', 'CODEBASE_INTELLIGENCE_REPOWISE_HOME', 'CODEBASE_INTELLIGENCE_DEEPWIKI_HOME']) if (process.env[name]) env[name] = process.env[name];
  return env;
}
export async function git(args: string[], signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try { return await runGit(args, signal); }
    catch (error) {
      if (!(error instanceof RepoError) || !error.transient || signal?.aborted || attempt >= 2 || args.includes('clone')) throw error;
      await delay(500 * (attempt + 1), undefined, { signal });
    }
  }
}
function runGit(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.longpaths=true', '-c', 'http.version=HTTP/1.1', '-c', 'core.hooksPath=', '-c', 'protocol.ext.allow=never', '-c', 'credential.interactive=false', '-c', 'core.sshCommand=ssh -oBatchMode=yes -oStrictHostKeyChecking=yes', ...args], { windowsHide: true, detached: process.platform !== 'win32', shell: false, env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let diagnostic = ''; let failure: Error | null = null;
    const abort = () => { failure = new RepoError('Sync cancelled. The published snapshot is unchanged.'); stopOwnedProcess(child); };
    const timer = setTimeout(() => { failure = new RepoError('Git timed out. Check connectivity and repository access, then retry.'); stopOwnedProcess(child); }, 120000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; if (Buffer.byteLength(output) > 8 * 1024 * 1024) { failure = new RepoError('Git output exceeded the repository limit.'); stopOwnedProcess(child); } });
    // Classify bounded diagnostics without exposing URLs, credentials or source.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-8192); });
    child.on('error', () => { failure = new RepoError('Git could not start. Install Git and relaunch the app.'); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0 && /SSL_read|bad record mac|RPC failed|early EOF|connection.*(reset|closed)|Could not resolve host|Failed to connect|HTTP (502|503|504)/i.test(diagnostic)) reject(new RepoError('The Git network connection failed. Check connectivity and retry; the published snapshot is preserved.', true));
      else if (code !== 0) reject(new RepoError('Git could not access the repository or branch. Check the URL, branch, network and existing Git credentials, then retry.'));
      else resolve(output.trim());
    });
  });
}
