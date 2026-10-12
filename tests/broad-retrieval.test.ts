import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { python } from './helpers';

test('broad natural-language questions retrieve configuration, architecture, security, tests and storage', async () => {
  const { stdout } = await promisify(execFile)(python, [resolve('tests/retrieval_broad.py')], { windowsHide: true, timeout: 10000 });
  assert.match(stdout, /8 broad retrieval checks passed/);
});
