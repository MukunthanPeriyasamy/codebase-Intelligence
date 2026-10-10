import test from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, workerEventSchema } from '../src/shared/contracts';
import { APP_URL, trustedSender } from '../src/main/security';

test('bridge rejects arbitrary operations, extra paths and invalid keys', () => {
  for (const input of [{ type: 'read-file', path: 'C:/secret' }, { type: 'worker.restart', python: 'evil' }, { type: 'credential.save', key: 'short' }, { type: 'credential.save', key: 'contains space' }, { type: 'credential.save', key: 'x'.repeat(513) }, null]) assert.equal(actionSchema.safeParse(input).success, false);
  assert.equal(actionSchema.safeParse({ type: 'credential.save', key: 'sk-or-test-key' }).success, false);
  assert.equal(workerEventSchema.safeParse({ v: 2, type: 'ready', python: '3.12.14', schema: 1 }).success, false);
  assert.equal(workerEventSchema.safeParse({ v: 1, type: 'ready', python: '3.11.9', schema: 1 }).success, false);
});
test('only the exact application main frame can call host services', () => {
  assert.equal(trustedSender(1, 1, true, APP_URL), true);
  assert.equal(trustedSender(2, 1, true, APP_URL), false);
  assert.equal(trustedSender(1, 1, false, APP_URL), false);
  for (const url of ['https://app/index.html', 'codebase://attacker/index.html', APP_URL + '?x', 'file:///index.html']) assert.equal(trustedSender(1, 1, true, url), false);
});


test('worker handshake accepts only explicitly supported Python minor versions', () => {
  for (const python of ['3.12.14', '3.14.2']) assert.equal(workerEventSchema.safeParse({ v: 1, type: 'ready', python, schema: 1 }).success, true);
  for (const python of ['3.11.9', '3.13.0', '3.15.0', '4.0.0']) assert.equal(workerEventSchema.safeParse({ v: 1, type: 'ready', python, schema: 1 }).success, false);
});
