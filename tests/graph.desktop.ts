import { test, expect, _electron as electron } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { python, temporary } from './helpers';

test('live graph renders indexed relationships, refreshes on publication and chat fills its section', async () => {
  test.setTimeout(90000);
  const source = await temporary('graph-source-'); const data = await temporary('graph-desktop-'); const exec = promisify(execFile);
  const git = async (...args: string[]) => (await exec('git', ['-C', source, '-c', 'user.name=Graph Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main'); await writeFile(join(source, 'main.py'), 'def helper():\n    return 1\ndef entry():\n    return helper()\n'); await git('add', '.'); await git('commit', '-m', 'graph');
  const env: Record<string, string> = { CODEBASE_INTELLIGENCE_DATA_DIR: data, CODEBASE_INTELLIGENCE_PYTHON: python };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, source);
    await page.getByRole('button', { name: 'Choose repository folder' }).click();
    await page.getByRole('button', { name: 'Knowledge Graph', exact: true }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(4, { timeout: 30000 });
    await expect(page.getByText(/Published snapshot/)).toBeVisible({ timeout: 15000 });
    await page.locator('.react-flow__node').filter({ hasText: 'entry' }).click();
    await expect(page.getByRole('region', { name: 'Selected graph node' })).toContainText('main.py:3');
    await page.screenshot({ path: 'test-results/knowledge-graph.png' });
    await page.getByLabel('Find a file or symbol').fill('nonexistent'); await expect(page.getByText('No matching displayed nodes')).toBeVisible(); await page.getByLabel('Find a file or symbol').fill('');
    await writeFile(join(source, 'main.py'), 'def replacement():\n    return 2\n'); await git('add', '.'); await git('commit', '-m', 'replace');
    await page.evaluate(() => window.desktop.syncRepository());
    await expect(page.locator('.react-flow__node').filter({ hasText: 'replacement' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.react-flow__node').filter({ hasText: 'helper' })).toHaveCount(0);
    await page.setViewportSize({ width: 780, height: 650 }); await page.screenshot({ path: 'test-results/knowledge-graph-narrow.png' });
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click();
    const composer = page.getByLabel('Repository question', { exact: true }); await composer.fill('Where is replacement defined?'); await composer.press('Enter');
    await expect(page.locator('.chat-answer')).toHaveCount(1, { timeout: 15000 }); await expect(composer).toHaveValue('');
    await composer.fill('draft'); await composer.press('Shift+Enter'); await expect(composer).toHaveValue('draft\n');
    const bounds = await page.locator('.chat-workspace').boundingBox(); const main = await page.locator('main').boundingBox();
    expect(bounds && main && Math.abs(bounds.width - main.width) < 2).toBe(true);
    await expect(page.getByRole('button', { name: 'Ask repository', exact: true })).toBeInViewport();
    await page.screenshot({ path: 'test-results/full-chat-narrow.png' });
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Documentation', exact: true }).click();
    await expect(page.getByText('Documentation generation is paused', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate / resume documentation', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Go to Chat', exact: true }).click();
    await expect(page.getByLabel('Repository question', { exact: true })).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
  } finally { await app.close(); }
});
