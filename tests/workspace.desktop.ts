import { test, expect, _electron as electron } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { python, temporary } from './helpers';

test('complete workspace preserves navigation state and source evidence through automatic background sync', async () => {
  test.setTimeout(120000);
  const source = await temporary('workspace-source-'); const directory = await temporary('workspace-data-');
  const exec = promisify(execFile);
  const git = async (...args: string[]) => (await exec('git', ['-C', source, '-c', 'user.name=Workspace Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main'); await writeFile(join(source, 'main.py'), 'def original():\n    return 1\n'); await git('add', '.'); await git('commit', '-m', 'original');
  const env: Record<string, string> = { CODEBASE_INTELLIGENCE_DATA_DIR: directory, CODEBASE_INTELLIGENCE_PYTHON: python };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env }); const errors: string[] = [];
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    const navigate = (name: string) => page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Repository', level: 1 })).toBeVisible();
    await navigate('Documentation'); await expect(page.getByText('No documentation published yet')).toBeVisible();
    await page.getByRole('button', { name: 'Configure model access' }).click(); await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await page.getByLabel('Ollama model ID').fill('test/model'); await page.getByLabel('Requests per run').fill('1');
    await navigate('Chat'); await page.getByLabel('Repository question', { exact: true }).fill('draft question');
    await navigate('Settings'); await expect(page.getByLabel('Ollama model ID')).toHaveValue('test/model');
    await page.getByRole('button', { name: 'Save generation settings' }).click();
    await expect(page.getByRole('checkbox', { name: /Automatically generate/ })).not.toBeChecked();
    await navigate('Chat'); await expect(page.getByLabel('Repository question', { exact: true })).toHaveValue('draft question');
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/api/show')) return Response.json({ capabilities: ['completion'] });
        if (String(url) !== 'http://127.0.0.1:11434/api/chat') throw new Error('Unexpected network request');
        const input = JSON.parse(JSON.parse(init!.body as string).messages[1].content); const item = input.evidence[0];
        const content = { title: 'Original function', sections: [{ title: 'Definition', kind: 'module', symbolId: null, claims: [{ text: 'The captured source defines original.', basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start, end: item.start, quote: item.text.split('\n')[0] }] }] }], gaps: ['Fixture response.'] };
        return new Response(JSON.stringify({ model: 'test/model', done: true, done_reason: 'stop', message: { content: JSON.stringify(input.question ? { sufficient: true, content, gaps: [] } : content) } }));
      };
    }, source);
    await navigate('Repository'); await page.getByRole('button', { name: 'Choose repository folder' }).click();
    await expect(page.getByTestId('sync-phase')).toHaveText('ready', { timeout: 30000 });
    const original = await git('rev-parse', 'HEAD');
    await page.screenshot({ path: 'test-results/workspace-repository.png' });
    await navigate('Documentation'); await page.getByRole('button', { name: 'Generate / resume documentation' }).click();
    await expect(page.getByTestId('docs-state')).toHaveText('partial', { timeout: 20000 });
    await page.getByRole('button', { name: /Original function/ }).click();
    await page.getByLabel('Find a page').fill('main.py');
    await navigate('Settings'); await navigate('Documentation');
    await expect(page.getByLabel('Find a page')).toHaveValue('main.py'); await expect(page.getByRole('heading', { name: 'Original function', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ask about this file' }).click();
    await expect(page.getByLabel('Repository question', { exact: true })).toHaveValue('Explain main.py');
    await expect(page.getByLabel('Repository question', { exact: true })).toBeFocused();
    const before = await page.evaluate(() => window.desktop.status()); expect(before.ok && before.status.docs.requestsToday).toBe(1);
    await page.getByRole('button', { name: 'Ask repository', exact: true }).click(); await expect(page.getByTestId('chat-state')).toHaveText('ready', { timeout: 20000 });
    await navigate('Documentation');
    const citation = page.getByRole('button', { name: 'main.py:1–1', exact: true }); await citation.click();
    await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('region', { name: 'Citation source' })).toContainText('def original():');
    await page.getByLabel('Wrap lines').check(); await page.screenshot({ path: 'test-results/workspace-source.png' });
    await page.keyboard.press('Escape'); await expect(citation).toBeFocused();
    await writeFile(join(source, 'main.py'), 'def updated():\n    return 2\n'); await git('add', '.'); await git('commit', '-m', 'background update'); const updated = await git('rev-parse', 'HEAD');
    await navigate('Chat'); await page.getByLabel('Repository question', { exact: true }).fill('keep this draft through sync');
    await navigate('Documentation'); await citation.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Citation source' })).toContainText('def original():');
    // Use the production sixty-second timer, not a test-only interval or manual sync.
    await expect.poll(async () => { const result = await page.evaluate(() => window.desktop.status()); return result.ok ? result.status.sync.repository?.active?.commit : ''; }, { timeout: 75000, intervals: [1000] }).toBe(updated);
    await expect(page.getByRole('dialog')).toContainText('Older commit'); await expect(page.getByRole('region', { name: 'Citation source' })).toContainText('def original():');
    await page.setViewportSize({ width: 780, height: 650 }); await page.screenshot({ path: 'test-results/workspace-source-narrow.png' });
    await page.keyboard.press('Escape'); await navigate('Chat');
    await expect(page.getByLabel('Repository question', { exact: true })).toHaveValue('keep this draft through sync');
    await expect(page.locator('.chat-answer .stale')).toContainText('Older commit');
    const result = await page.evaluate(() => window.desktop.status()); expect(result.ok && result.status.docs.requestsToday).toBe(2); expect(result.ok && result.status.chat.answers[0]?.commit).toBe(original);
    await page.getByRole('button', { name: /^Notifications/ }).click(); await expect(page.getByRole('dialog', { name: 'Notifications' }).getByText('New repository commit detected', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: /^Notifications/ })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/workspace-chat-narrow.png' }); expect(errors).toEqual([]);
  } finally { await app.close(); }
});
