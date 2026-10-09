import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
import { python, temporary } from './helpers';

test('model catalogs search, select, save and retain selections after a failed refresh and restart', async () => {
  const data = await temporary('models-desktop-');
  const env: Record<string, string> = { CODEBASE_INTELLIGENCE_DATA_DIR: data, CODEBASE_INTELLIGENCE_PYTHON: python };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ['.'], cwd: resolve('.'), env });
  try {
    let page = await app.firstWindow();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await app.evaluate(() => {
      globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/api/tags')) return Response.json({ models: [{ name: 'test/chat' }, { name: 'test/embed' }] });
        const model = JSON.parse(init!.body as string).model;
        return Response.json({ capabilities: [model === 'test/embed' ? 'embedding' : 'completion'] });
      };
    });
    await page.getByRole('button', { name: 'Refresh chat models', exact: true }).click();
    await page.getByLabel('Search chat models', { exact: true }).fill('test');
    await page.getByLabel('Available chat models', { exact: true }).selectOption('test/chat');
    await page.getByRole('button', { name: 'Refresh embedding models', exact: true }).click();
    await page.getByLabel('Available embedding models', { exact: true }).selectOption('test/embed');
    await page.getByRole('button', { name: 'Save generation settings', exact: true }).click();
    await expect(page.getByText('Generation settings saved.', { exact: true })).toBeVisible();
    const status = await page.evaluate(() => window.desktop.status()); expect(status.ok && status.status.docs.settings.embeddingModel).toBe('test/embed'); expect(status.ok && status.status.docs.requestsToday).toBe(0);
    await app.evaluate(() => { globalThis.fetch = async () => new Response('', { status: 503 }); });
    await page.getByRole('button', { name: 'Refresh embedding models', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Generation settings' }).getByText(/Ollama model list is unavailable/)).toBeVisible();
    await expect(page.getByLabel('Ollama embedding model ID', { exact: true })).toHaveValue('test/embed');
    await page.getByLabel('Ollama embedding model ID', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/model-settings.png' });
    await app.close(); app = await electron.launch({ args: ['.'], cwd: resolve('.'), env }); page = await app.firstWindow();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Ollama embedding model ID', { exact: true })).toHaveValue('test/embed');
    await expect(page.getByLabel('Ollama model ID', { exact: true })).toHaveValue('test/chat');
  } finally { await app.close(); }
});

