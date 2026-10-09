import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels } from '../src/main/models';
import { actionSchema } from '../src/shared/contracts';
import { defaultDocSettings, docSettingsSchema } from '../src/shared/documentation';

test('Ollama catalogs use loopback endpoints and filter installed model capabilities', async () => {
  const calls: string[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push(String(url)); assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).has('Authorization'), false);
    if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen2.5-coder:14b' }, { name: 'embedding:latest' }, { name: 'remote:cloud' }] });
    const model = JSON.parse(init!.body as string).model;
    return Response.json({ capabilities: [model === 'embedding:latest' ? 'embedding' : 'completion'] });
  };
  const chat = await listModels('chat', undefined, transport); const embeddings = await listModels('embedding', undefined, transport);
  assert.deepEqual(chat.models.map(item => item.id), ['qwen2.5-coder:14b']);
  assert.deepEqual(embeddings.models.map(item => item.id), ['embedding:latest']);
  assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:11434/api/')));
});

test('Ollama catalog errors are sanitized and renderer cannot supply endpoints', async () => {
  for (const transport of [async () => Response.json({ secret: 'private' }), async () => new Response('private', { status: 401 })]) {
    await assert.rejects(listModels('embedding', undefined, transport), error => error instanceof Error && !error.message.includes('private') && error.message.includes('refresh'));
  }
  assert.deepEqual(docSettingsSchema.parse(defaultDocSettings), defaultDocSettings);
  assert.equal(docSettingsSchema.parse({ ...defaultDocSettings, model: 'qwen2.5-coder:14b' }).model, 'qwen2.5-coder:14b');
  assert.equal(actionSchema.safeParse({ type: 'models.list', kind: 'embedding', url: 'https://attacker.invalid' }).success, false);
  assert.equal(actionSchema.safeParse({ type: 'ollama.test', url: 'https://attacker.invalid' }).success, false);
});
