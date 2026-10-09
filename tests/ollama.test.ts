import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { structuredCompletion, inspectModel, ProviderError } from '../src/main/ollama';
import { defaultDocSettings } from '../src/shared/documentation';

test('Ollama completion sends schema, saved output budget and local-only options; classifies invalid responses without retries', async () => {
  const original = globalThis.fetch; let requests = 0;
  const settings = { ...defaultDocSettings, model: 'qwen2.5-coder:14b', maxOutputTokens: 12000 };
  const schema = z.object({ summary: z.string() }).strict();
  let response: unknown = { model: settings.model, done: true, done_reason: 'stop', message: { content: '{"summary":"ok"}' } };
  try {
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).startsWith('http://127.0.0.1:11434/api/'));
      assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).has('Authorization'), false);
      if (String(url).endsWith('/show')) return Response.json({ capabilities: ['completion', 'thinking'] });
      requests++; const body = JSON.parse(init!.body as string);
      assert.equal(body.options.num_predict, 12000); assert.equal(body.options.num_ctx, 32768); assert.equal(body.stream, false); assert.equal(body.think, false);
      assert.ok(body.format.properties.summary); return Response.json(response);
    };
    assert.deepEqual(await structuredCompletion(settings, schema, 'fixture', {}, new AbortController().signal), { content: { summary: 'ok' }, cost: 0, servedModel: settings.model });
    for (const [reason, code] of [['length', 'output-truncated'], ['error', 'incomplete-response']]) {
      response = { model: settings.model, done: true, done_reason: reason, eval_count: 12000, message: { content: 'private-secret' } };
      await assert.rejects(structuredCompletion(settings, schema, '', {}, new AbortController().signal), error => error instanceof ProviderError && error.message.includes(code!) && !error.message.includes('private-secret'));
    }
    response = { model: settings.model, done: true, message: { content: '{"private-secret":123}' } };
    await assert.rejects(structuredCompletion(settings, schema, '', {}, new AbortController().signal), /document-schema/);
    assert.equal(requests, 4);
    globalThis.fetch = async () => Response.json({ capabilities: ['completion'], remote_model: 'remote' });
    await assert.rejects(inspectModel('custom'), /local model/);
    globalThis.fetch = async () => { throw new Error('private-secret'); };
    await assert.rejects(inspectModel('custom'), /Start Ollama/);
  } finally { globalThis.fetch = original; }
});
