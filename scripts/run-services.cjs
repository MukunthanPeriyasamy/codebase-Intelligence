/* Supervise independent FastAPI and Next.js processes, without shell quoting. */
const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is in use. Stop the existing service before npm start.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function waitForBackend(isAlive, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('Backend exited during startup. See the backend output above.');
    try {
      const response = await fetch('http://127.0.0.1:8001/api/v1/ready', { signal: AbortSignal.timeout(2000) });
      const body = await response.json();
      if (response.ok && body.status === 'ready' && body.service === 'deepwiki-api') return;
    } catch { /* Retry while our backend is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Backend readiness timed out. Check the backend output above.');
}
function stopChild(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' });
    if (result.status !== 0) {
      try { child.kill(); } catch { /* Report failure below. */ }
      console.warn(`Process-tree cleanup could not be confirmed for PID ${child.pid}: ${result.stderr?.toString().trim() || result.error?.message || 'taskkill failed'}`);
    }
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
}
async function main() {
  const mode = process.argv[2] || 'all';
  if (!['all', 'backend', 'frontend'].includes(mode)) throw new Error(`Unknown service: ${mode}`);
  const children = [];
  let stopping = false;
  const stop = code => {
    if (stopping) return;
    stopping = true;
    for (const child of children) stopChild(child);
    process.exit(code);
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  const env = { ...process.env,
    SERVER_BASE_URL: 'http://127.0.0.1:8001', PYTHON_BACKEND_HOST: 'http://127.0.0.1:8001',
    NEXT_PUBLIC_API_PORT: '8001', NEXT_PUBLIC_WS_BASE_URL: 'ws://127.0.0.1:8001',
    TIKTOKEN_CACHE_DIR: path.join(root, '.local/deepwiki-tool/token-cache'), PYTHONUNBUFFERED: '1' };
  const launch = (name, command, args, extraEnv = {}) => {
    console.log(`[${name}] Starting`);
    const child = spawn(command, args, {cwd: root, env: {...env, ...extraEnv}, stdio:'inherit',
      windowsHide:true, detached:process.platform !== 'win32'});
    children.push(child);
    child.on('error', error => { console.error(`[${name}] ${error.message}`); stop(1); });
    child.on('exit', (code, signal) => {
      if (name === 'backend' && typeof code === 'number' && (code >>> 0) === 0xC0000005) {
        console.error('[backend] Native access violation (0xC0000005). Inspect .local/logs/backend-fault.log for the crashing stack. This is not an authentication error.');
      }
      if (!stopping) { console.error(`[${name}] exited (${code ?? signal}); stopping companion service.`); stop(code === 0 ? 0 : 1); }
    });
    return child;
  };
  try {
    if (mode !== 'frontend') {
      await assertPortFree(8001);
      if (mode === 'all') await assertPortFree(3000);
      const python = path.join(root, '.local/deepwiki-tool/runtime', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (!existsSync(python)) throw new Error('Backend runtime missing. Run scripts/setup-deepwiki.ps1 first.');
      const backend = launch('backend', python, ['-m', 'api.serve'], {NODE_ENV:'production'});
      await waitForBackend(() => backend.exitCode === null && !stopping);
      console.log('[backend] Ready: http://127.0.0.1:8001/docs (ChromaDB verified)');
    }
    if (mode !== 'backend') {
      if (mode === 'frontend') await assertPortFree(3000);
      launch('frontend', process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--turbopack', '--port', '3000', '--hostname', '127.0.0.1'], {NODE_ENV:'development'});
      console.log('[frontend] http://127.0.0.1:3000 — Ctrl+C stops services started here.');
    }
  } catch (error) { console.error(error.message); stop(1); }
}
module.exports = { assertPortFree, waitForBackend, stopChild };
if (require.main === module) main().catch(error => {console.error(error); process.exitCode=1;});
