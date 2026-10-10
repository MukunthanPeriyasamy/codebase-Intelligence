import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CredentialStore } from '../src/main/credentials';
import { completionRouter } from '../src/main/providers';
import { completionSchema } from '../src/main/provider-schema';
import { listOpenRouterModels } from '../src/main/openrouter';
import { ProviderError } from '../src/main/ollama';
import { defaultDocSettings, generatedSchema } from '../src/shared/documentation';
import { temporary } from './helpers';

test('keys are encrypted, replaceable and removable without returning plaintext in status', async () => {
  const directory = await temporary('provider-key-');
  const store = new CredentialStore(directory, { available: () => true, encrypt: key => Buffer.from(key).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() });
  await store.save('fixture-secret-key');
  assert.equal((await readFile(join(directory, 'openrouter.enc'))).includes('fixture-secret-key'), false);
  assert.equal((await store.status()).configured, true); assert.equal(JSON.stringify(await store.status()).includes('fixture-secret-key'), false);
  assert.equal(await store.read(), 'fixture-secret-key'); await store.save('replacement-key'); assert.equal(await store.read(), 'replacement-key');
  await store.clear(); assert.equal((await store.status()).configured, false);
  const locked = new CredentialStore(directory, { available: () => false, encrypt: () => { throw new Error(); }, decrypt: () => '' });
  await assert.rejects(locked.save('fixture-secret-key'), /encryption/);
});

test('routing isolates Ollama from credentials and OpenRouter uses bounded schema output without retries', async () => {
  const original = globalThis.fetch; let keyReads = 0; let calls = 0;
  const complete = completionRouter(async () => { keyReads++; return 'fixture-secret-key'; });
  const schema = z.object({ value: z.string() }).strict();
  let finish = 'stop'; let cost: number | null = null;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(init?.redirect, 'error');
      if (String(url).includes('127.0.0.1')) {
        assert.equal(new Headers(init?.headers).has('Authorization'), false);
        if (String(url).endsWith('/show')) return Response.json({ capabilities: ['completion'] });
        return Response.json({ model: 'same/model', done: true, done_reason: 'stop', message: { content: '{"value":"local"}' } });
      }
      assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-secret-key');
      const body = JSON.parse(init!.body as string); assert.equal(body.max_tokens, 8000); assert.equal(body.provider.allow_fallbacks, false); assert.equal(body.response_format.type, 'json_schema');
      return Response.json({ model: 'same/model', choices: [{ finish_reason: finish, message: { content: '{"value":"remote"}' } }], usage: { cost, completion_tokens: 8000 } });
    };
    const local = await complete({ ...defaultDocSettings, model: 'same/model' }, schema, '', {}, new AbortController().signal);
    assert.equal(local.content.value, 'local'); assert.equal(keyReads, 0);
    const settings = { ...defaultDocSettings, provider: 'openrouter' as const, model: 'same/model' };
    const remote = await complete(settings, schema, '', {}, new AbortController().signal);
    assert.equal(remote.content.value, 'remote'); assert.equal(remote.cost, null); assert.equal(keyReads, 1);
    finish = 'length'; cost = 0.02;
    await assert.rejects(complete(settings, schema, '', {}, new AbortController().signal), error => error instanceof ProviderError && error.cost === 0.02 && error.message.includes('output-truncated'));
    assert.equal(calls, 4);
    globalThis.fetch = async () => new Response('fixture-secret-key', { status: 401 });
    await assert.rejects(complete(settings, schema, '', {}, new AbortController().signal), error => error instanceof Error && error.message.includes('API key rejected') && !error.message.includes('fixture-secret-key'));
    globalThis.fetch = async () => { throw new Error('fixture-secret-key'); };
    await assert.rejects(complete(settings, schema, '', {}, new AbortController().signal), /connection/);
  } finally { globalThis.fetch = original; }
});

test('OpenRouter catalogs use separate fixed endpoints without inference', async () => {
  const original = globalThis.fetch; const paths: string[] = [];
  try {
    globalThis.fetch = async (url, init) => { paths.push(String(url)); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); return Response.json({ data: [{ id: 'test/model', name: 'Fixture', supported_parameters: ['structured_outputs'] }] }); };
    assert.equal((await listOpenRouterModels('chat', 'fake-key')).models[0]?.structured, true);
    await listOpenRouterModels('embedding', 'fake-key');
    assert.deepEqual(paths, ['https://openrouter.ai/api/v1/models', 'https://openrouter.ai/api/v1/embeddings/models']);
  } finally { globalThis.fetch = original; }
});


test('Gemini wire schema uses supported constraints and still validates full model output', async () => {
  const wire = JSON.stringify(completionSchema(generatedSchema, 'google/gemini-2.5-flash'));
  assert.equal(wire.includes('"exclusiveMinimum":'), false);
  assert.equal(wire.includes('"minLength":'), false);
  assert.equal(wire.includes('"pattern":'), false);
  assert.equal(wire.includes('"anyOf":'), false);
  assert.ok(wire.includes('"minimum":1'));
  assert.ok(wire.includes('"type":["string","null"]'));
  assert.ok(wire.includes('"additionalProperties":false'));
  assert.ok(JSON.stringify(completionSchema(generatedSchema, 'other/model')).includes('"exclusiveMinimum":'));
  const chatWire = JSON.stringify(completionSchema(z.object({ content: generatedSchema.nullable() }).strict(), 'google/gemini-2.5-flash'));
  assert.ok(chatWire.includes('"type":["object","null"]'));
  assert.equal(chatWire.includes('"exclusiveMinimum":'), false);
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ model: 'google/gemini-2.5-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '', sections: [], gaps: [] }) } }] }); };
    const complete = completionRouter(async () => 'fixture-key');
    await assert.rejects(complete({ ...defaultDocSettings, provider: 'openrouter', model: 'google/gemini-2.5-flash' }, generatedSchema, '', {}, new AbortController().signal), /document-schema/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('HTTP 400 diagnostics classify bounded errors without leaking provider content or retrying', async () => {
  const original = globalThis.fetch; let calls = 0;
  const complete = completionRouter(async () => 'fixture-secret');
  try {
    for (const [body, expected] of [
      [JSON.stringify({ error: { message: 'Provider error', metadata: { raw: 'responseSchema exclusiveMinimum rejected fixture-secret private-source' } } }), /involving exclusiveMinimum/],
      [JSON.stringify({ error: { message: 'fixture-secret private-source' } }), /cause could not be identified/],
      ['x'.repeat(65537), /cause could not be identified/],
    ] as const) {
      globalThis.fetch = async () => { calls++; return new Response(body, { status: 400 }); };
      await assert.rejects(complete({ ...defaultDocSettings, provider: 'openrouter', model: 'google/gemini-2.5-flash' }, generatedSchema, '', {}, new AbortController().signal), error => error instanceof Error && expected.test(error.message) && !/fixture-secret|private-source/.test(error.message));
    }
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
