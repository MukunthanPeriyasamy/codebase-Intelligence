import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { structuredCompletion, inspectModel, ProviderError, ollamaJson, OLLAMA_GENERATION_TIMEOUT_MS } from '../src/main/ollama';
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


test('Ollama deadline distinguishes slow generation from cancellation and clears its timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const waiting: typeof fetch = async (_url, init) => {
    calls++;
    assert.ok((init as RequestInit & { dispatcher?: unknown }).dispatcher);
    return await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('private-server-details')), { once: true });
    });
  };
  const result = ollamaJson('/api/chat', {}, undefined, waiting);
  const checked = assert.rejects(result, /generation exceeded 30 minutes/);
  t.mock.timers.tick(OLLAMA_GENERATION_TIMEOUT_MS);
  await checked;
  const controller = new AbortController();
  const stopped = assert.rejects(ollamaJson('/api/chat', {}, controller.signal, waiting), /request stopped/);
  controller.abort(); await stopped;
  const metadata = assert.rejects(ollamaJson('/api/show', {}, undefined, waiting), /model information took over 60 seconds/);
  t.mock.timers.tick(60000); await metadata;
  assert.equal(calls, 3);
});

test('Ollama timeout and Stop also abort response-body reads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport: typeof fetch = async (_url, init) => new Response(new ReadableStream({
    start(controller) { init!.signal!.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }); }
  }));
  const result = ollamaJson('/api/chat', {}, undefined, transport);
  const checked = assert.rejects(result, /generation exceeded 30 minutes/);
  await Promise.resolve(); t.mock.timers.tick(OLLAMA_GENERATION_TIMEOUT_MS); await checked;
});


test('real Node fetch accepts the Ollama dispatcher and reads delayed headers/body', async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"models":');
      setTimeout(() => response.end('[]}'), 40);
    }, 40);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const transport: typeof fetch = (_url, init) => fetch(`http://127.0.0.1:${address.port}/api/tags`, init);
    assert.deepEqual(await ollamaJson('/api/tags', undefined, undefined, transport), { models: [] });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
