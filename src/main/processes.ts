import { spawn, type ChildProcess } from 'node:child_process';

// Git can own HTTPS/SSH helpers. Stop only the tree created by this operation.
export function stopOwnedProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.on('error', () => { child.kill(); });
    killer.on('exit', code => { if (code !== 0) child.kill(); });
  } else {
    // Git/snapshot jobs create their own process group on Unix.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  }
}
