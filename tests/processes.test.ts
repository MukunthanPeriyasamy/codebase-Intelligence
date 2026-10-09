import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { stopOwnedProcess } from '../src/main/processes';
import { until } from './helpers';

test('cancellation stops the owned process and its helper', { timeout: 10000 }, async () => {
  const source = "const {spawn}=require('node:child_process'); const helper=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',windowsHide:true}); console.log(helper.pid); setInterval(()=>{},1000);";
  const child = spawn(process.execPath, ['-e', source], { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  let output = ''; child.stdout.on('data', chunk => { output += String(chunk); });
  const closed = new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('close', () => resolve()); });
  try {
    await until(() => output.includes('\n'));
    const helper = Number(output.trim()); assert.ok(helper > 0);
    stopOwnedProcess(child); await closed;
    await until(() => { try { process.kill(helper, 0); return false; } catch { return true; } });
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally { stopOwnedProcess(child); }
});
