import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { WorkerService } from '../src/main/worker';
import { python, temporary, until } from './helpers';

test('real Python worker initializes SQLite, heartbeats, stops and restarts', async () => {
  const states: string[] = [];
  const service = new WorkerService({ python, script: resolve('worker/service.py'), dataDir: await temporary('worker-'), heartbeatMs: 30, responseMs: 1500 }, () => states.push(service.status.state));
  try {
    await service.restart(); await until(() => service.status.state === 'ready');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(service.status.state, 'ready'); assert.equal(service.status.storageReady, true);
    await service.stop(); assert.equal(service.status.state, 'stopped');
    await service.restart(); await until(() => service.status.state === 'ready');
    assert.equal(states.filter(state => state === 'ready').length, 2);
  } finally { await service.stop(); }
});
test('missing runtime gives actionable sanitized failure', async () => {
  const service = new WorkerService({ python: resolve('.local/missing-python.exe'), script: resolve('worker/service.py'), dataDir: await temporary('missing-') }, () => {});
  try { await service.restart(); await until(() => service.status.state === 'error'); assert.equal(service.status.error?.code, 'WORKER_START'); }
  finally { await service.stop(); }
});
test('stop during restart waits for the transition and leaves no running worker', async () => {
  const service = new WorkerService({ python, script: resolve('worker/service.py'), dataDir: await temporary('race-') }, () => {});
  try {
    await service.restart(); await until(() => service.status.state === 'ready');
    const restarting = service.restart();
    const stopping = service.stop();
    await Promise.all([restarting, stopping]);
    assert.equal(service.status.state, 'stopped');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(service.status.state, 'stopped');
  } finally { await service.stop(); }
});
test('incompatible storage schema is preserved and reported', async () => {
  const dir = await temporary('schema-');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, ['-I', '-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("PRAGMA user_version=999"); c.close()', join(dir, 'metadata.sqlite3')], { windowsHide: true });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('Fixture failed')));
  });
  const service = new WorkerService({ python, script: resolve('worker/service.py'), dataDir: dir }, () => {});
  try { await service.restart(); await until(() => service.status.state === 'error'); assert.equal(service.status.error?.code, 'STORAGE_INIT'); }
  finally { await service.stop(); }
});
for (const [name, source, expected] of [
  ['startup timeout', 'import time; time.sleep(60)', 'WORKER_TIMEOUT'],
  ['protocol noise', 'print("sensitive-source-must-not-reach-ui", flush=True)', 'WORKER_PROTOCOL'],
  ['oversized message', 'print("x" * 70000, flush=True)', 'WORKER_PROTOCOL'],
  ['crash', 'raise SystemExit(7)', 'WORKER_EXIT'],
  ['unresponsive worker', 'import time; print(\'{"v":1,"type":"ready","python":"3.12.14","schema":1}\', flush=True); time.sleep(60)', 'WORKER_TIMEOUT'],
] as const) {
  test(`worker handles ${name}`, async () => {
    const dir = await temporary('failure-'); const script = join(dir, 'fixture.py'); await writeFile(script, source);
    const service = new WorkerService({ python, script, dataDir: dir, startupMs: 1500, heartbeatMs: 30, responseMs: 150 }, () => {});
    try { await service.restart(); await until(() => service.status.state === 'error'); assert.equal(service.status.error?.code, expected); assert.equal(JSON.stringify(service.status).includes('sensitive-source'), false); }
    finally { await service.stop(); }
  });
}
test('worker accepts only versioned private requests and exits on malformed input', async () => {
  const dir = await temporary('protocol-');
  const child = spawn(python, ['-I', '-u', resolve('worker/service.py'), '--data-dir', dir], { windowsHide: true });
  let output = ''; child.stdout.on('data', chunk => { output += chunk.toString(); });
  const closed = new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  try {
    await until(() => output.includes('ready'));
    const id = randomUUID(); child.stdin.write(JSON.stringify({ v: 1, type: 'ping', id }) + '\n');
    await until(() => output.includes(id));
    child.stdin.write('{"v":1,"type":"read-file","path":"secret"}\n');
    assert.equal(await closed, 1); assert.ok(output.includes('REQUEST_INVALID')); assert.equal(output.includes('secret'), false);
  } finally { child.kill(); }
});
