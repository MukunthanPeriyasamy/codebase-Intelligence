import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddingProvider } from '../src/main/vectors';
import type { DocumentationService } from '../src/main/documentation';
import { defaultDocSettings } from '../src/shared/documentation';

test('embedding adapters use the selected model, validate counts and isolate local credentials', async () => {
  const original = globalThis.fetch; let billed = 0; let invalid = false;
  const docs = { requestInteractive: async (run: () => Promise<unknown>) => { billed++; return run(); } } as unknown as DocumentationService;
  const embed = embeddingProvider(docs, async () => 'fixture-key');
  try {
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init!.body as string);
      if (String(url).endsWith('/show')) return Response.json({ capabilities: ['embedding'] });
      assert.equal(body.model, 'fixture-embedding'); assert.deepEqual(body.input, ['first', 'second']);
      if (String(url).includes('127.0.0.1')) {
        assert.equal(new Headers(init?.headers).has('Authorization'), false); assert.equal(body.truncate, false);
        return Response.json({ embeddings: invalid ? [[1,0]] : [[1,0], [0,1]] });
      }
      assert.ok(String(url).endsWith('/embeddings')); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-key');
      return Response.json({ data: [{ index: 1, embedding: [0,1] }, { index: 0, embedding: [1,0] }], usage: { cost: 0.001 } });
    };
    const settings = { ...defaultDocSettings, embeddingModel: 'fixture-embedding' };
    assert.deepEqual(await embed(settings, ['first','second'], new AbortController().signal), [[1,0],[0,1]]); assert.equal(billed, 0);
    invalid = true; await assert.rejects(embed(settings, ['first','second'], new AbortController().signal), /count/);
    assert.deepEqual(await embed({ ...settings, provider: 'openrouter' }, ['first','second'], new AbortController().signal), [[1,0],[0,1]]); assert.equal(billed, 1);
  } finally { globalThis.fetch = original; }
});
