import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { python, temporary } from './helpers';

async function launch(directory: string, runtime = python) {
  const env: Record<string, string> = { CODEBASE_INTELLIGENCE_DATA_DIR: directory, CODEBASE_INTELLIGENCE_PYTHON: runtime };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ args: ['.'], cwd: resolve('.'), env });
}
test('desktop launch, sandbox, local Ollama connection and worker controls', async () => {
  const app = await launch(await temporary('desktop-'));
  try {
    const page = await app.firstWindow();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByTestId('worker-state')).toHaveText('ready');
    expect(await page.evaluate(() => typeof Reflect.get(window, 'require'))).toBe('undefined');
    expect(await page.evaluate(() => Object.keys(window.desktop))).not.toContain('saveCredential');
    await app.evaluate(() => { globalThis.fetch = async () => Response.json({ models: [] }); });
    await page.getByRole('button', { name: 'Test Ollama connection' }).click();
    await expect(page.getByTestId('ollama-state')).toHaveText('Connected');
    await page.getByRole('button', { name: 'Stop service', exact: true }).click();
    await expect(page.getByTestId('worker-state')).toHaveText('stopped');
    await page.getByRole('button', { name: 'Start service', exact: true }).click();
    await expect(page.getByTestId('worker-state')).toHaveText('ready');
    await page.screenshot({ path: 'test-results/ollama-settings.png', fullPage: true });
  } finally { await app.close(); }
});
test('missing Python reaches the UI as an actionable failure', async () => {
  const app = await launch(await temporary('desktop-failure-'), resolve('.local/no-python.exe'));
  try {
    const page = await app.firstWindow();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByTestId('worker-state')).toHaveText('error');
    await expect(page.getByRole('alert')).toContainText('CODEBASE_INTELLIGENCE_PYTHON');
    await page.screenshot({ path: 'test-results/foundation-error.png', fullPage: true });
  } finally { await app.close(); }
});
test('legacy encrypted credentials are not read or required', async () => {
  const data = await temporary('desktop-legacy-');
  await mkdir(join(data, 'credentials'));
  await writeFile(join(data, 'credentials/openrouter.enc'), 'invalid-encrypted-data');
  const app = await launch(data);
  try {
    const page = await app.firstWindow();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByTestId('worker-state')).toHaveText('ready');
    await expect(page.getByRole('heading', { name: 'Connect Ollama' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await app.close(); }
});
