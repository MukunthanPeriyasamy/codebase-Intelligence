import { test, expect, _electron as electron } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { python, temporary } from './helpers';

test('chat performs free lookups, cited model answers, cache reuse and commit invalidation in Electron', async () => {
  test.setTimeout(90000);
  const source = await temporary('desktop-chat-source-'); const directory = await temporary('desktop-chat-'); const exec = promisify(execFile);
  const git = async (...args: string[]) => (await exec('git', ['-C', source, '-c', 'user.name=Chat Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main'); await writeFile(join(source, 'main.py'), 'def helper():\n    return 1\n'); await git('add', '.'); await git('commit', '-m', 'first');
  const env: Record<string, string> = { CODEBASE_INTELLIGENCE_DATA_DIR: directory, CODEBASE_INTELLIGENCE_PYTHON: python };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env }); const errors: string[] = [];
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('worker-state')).toHaveText('ready');
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/api/show')) return Response.json({ capabilities: ['completion'] });
        if (String(url) !== 'http://127.0.0.1:11434/api/chat') throw new Error('Unexpected external request');
        const input = JSON.parse(JSON.parse(init!.body as string).messages[1].content); const item = input.evidence[0];
        const content = { sufficient: true, content: { title: 'Helper explanation', sections: [{ title: 'Behavior', kind: 'module', symbolId: null, claims: [{ text: 'The helper is defined in the captured Python source.', basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start, end: item.start, quote: item.text.split('\n')[0] }] }] }], gaps: ['Fixture provider response.'] }, gaps: [] };
        return new Response(JSON.stringify({ model: 'test/model', done: true, done_reason: 'stop', message: { content: JSON.stringify(content) }, eval_count: 100 }));
      };
    }, source);
    await page.getByRole('button', { name: 'Choose repository folder' }).click(); await expect(page.getByTestId('sync-phase')).toHaveText('ready', { timeout: 30000 });
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByLabel('Repository question', { exact: true }).fill('Where is helper defined?'); await page.getByRole('button', { name: 'Ask repository', exact: true }).click();
    await expect(page.getByTestId('chat-state')).toHaveText('ready', { timeout: 15000 });
    await page.getByRole('button', { name: 'main.py:1–1', exact: true }).click(); await expect(page.getByRole('region', { name: 'Chat citation source' })).toContainText('def helper():');
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Ollama model ID').fill('test/model'); await page.getByRole('button', { name: 'Save generation settings' }).click();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('button', { name: 'New conversation' }).click(); await expect(page.locator('.chat-answer')).toHaveCount(0);
    await page.getByLabel('Repository question', { exact: true }).fill('Explain helper'); await page.getByRole('button', { name: 'Ask repository', exact: true }).click();
    await expect(page.getByTestId('chat-state')).toHaveText('ready', { timeout: 15000 });
    await expect(page.getByText('The helper is defined in the captured Python source.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'main.py:1–1', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Chat citation source' })).toContainText('def helper():');
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/chat.png' });

    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('button', { name: 'New conversation' }).click(); await expect(page.locator('.chat-answer')).toHaveCount(0);
    await page.getByLabel('Repository question', { exact: true }).fill('Explain helper');
    await page.getByRole('button', { name: 'Ask repository', exact: true }).click(); await expect(page.getByTestId('chat-state')).toHaveText('ready', { timeout: 15000 });
    await expect(page.getByText(/Verified cache hit/)).toBeVisible(); await expect(page.locator('.answer-quality')).toContainText('evidence estimate');
    const status = await page.evaluate(() => window.desktop.status()); expect(status.ok && status.status.docs.requestsToday).toBe(1);
    await writeFile(join(source, 'main.py'), 'def replacement():\n    return 2\n'); await git('add', '.'); await git('commit', '-m', 'replace');
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Repository', exact: true }).click();
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click(); await expect(page.getByText('· Older commit', { exact: false })).toBeVisible({ timeout: 30000 });
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByLabel('Repository question', { exact: true }).fill('Where is helper defined?'); await page.getByRole('button', { name: 'Ask repository', exact: true }).click();
    await expect(page.getByTestId('chat-state')).toHaveText('ready', { timeout: 15000 }); await expect(page.locator('.chat-answer > p.muted').filter({ hasText: 'Insufficient evidence' })).toBeVisible();
    await expect(page.locator('.answer-quality').last()).toContainText('Confidence: 0/100');
    await page.setViewportSize({ width: 780, height: 650 });
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/chat-narrow.png' });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
  } finally { await app.close(); }
});
