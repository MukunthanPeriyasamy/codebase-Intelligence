import { test, expect, _electron as electron } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { python, temporary } from './helpers';

test('switch providers, generate OpenRouter docs/chat, restore Ollama and persist encrypted access', async () => {
  test.setTimeout(90000);
  const source = await temporary('dual-source-'); const data = await temporary('dual-data-');
  const exec = promisify(execFile);
  const git = async (...args: string[]) => exec('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true });
  await git('init', '-b', 'main'); await writeFile(join(source, 'main.py'), 'def helper():\n    return 1\n'); await git('add', '.'); await git('commit', '-m', 'fixture');
  const env: Record<string, string> = { CODEBASE_INTELLIGENCE_DATA_DIR: data, CODEBASE_INTELLIGENCE_PYTHON: python };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ['.'], cwd: resolve('.'), env });
  try {
    let page = await app.firstWindow();
    await expect(page.getByTestId('worker-state')).toHaveText('ready');
    await app.evaluate(({ dialog }, sourcePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] });
      globalThis.fetch = async (url, init) => {
        const address = String(url); const remote = address.startsWith('https://openrouter.ai/api/v1/');
        if (!remote && !address.startsWith('http://127.0.0.1:11434/api/')) throw new Error('Unexpected endpoint');
        if (remote && new Headers(init?.headers).get('Authorization') !== 'Bearer fixture-key-not-real') throw new Error('Missing key');
        if (!remote && new Headers(init?.headers).has('Authorization')) throw new Error('Key leaked to Ollama');
        if (address.endsWith('/models')) return Response.json({ data: [{ id: 'test/remote', name: 'Remote Fixture', supported_parameters: ['structured_outputs'] }] });
        if (address.endsWith('/show')) return Response.json({ capabilities: ['completion'] });
        const body = JSON.parse(init!.body as string); const input = JSON.parse(body.messages[1].content); const item = input.evidence[0];
        const content = { title: remote ? 'Remote documentation' : 'Local documentation', sections: [{ title: 'Behavior', kind: 'module', symbolId: null, claims: [{ text: 'The captured source defines helper.', basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start, end: item.start, quote: item.text.split('\n')[0] }] }] }], gaps: [] };
        const output = JSON.stringify(input.question ? { sufficient: true, content, gaps: [] } : content);
        return remote ? Response.json({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: output } }], usage: { cost: 0.001 } }) : Response.json({ model: body.model, done: true, done_reason: 'stop', message: { content: output } });
      };
    }, source);
    await page.getByRole('button', { name: 'Choose repository folder' }).click();
    await expect(page.getByTestId('sync-phase')).toHaveText('ready', { timeout: 30000 });
    const nav = (name: string) => page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name, exact: true }).click();
    await nav('Settings'); await page.getByLabel('Ollama model ID', { exact: true }).fill('test:local');
    await page.getByRole('button', { name: 'Save generation settings' }).click();
    await page.getByLabel('OpenRouter API key').fill('fixture-key-not-real'); await page.getByRole('button', { name: 'Save key', exact: true }).click();
    await expect(page.getByTestId('credential-state')).toHaveText('Key saved');
    expect((await readFile(join(data, 'credentials/openrouter.enc'))).includes('fixture-key-not-real')).toBe(false);
    expect(JSON.stringify(await page.evaluate(() => window.desktop.status()))).not.toContain('fixture-key-not-real');
    await page.getByLabel('Model provider', { exact: true }).selectOption('openrouter');
    await page.getByRole('button', { name: 'Refresh chat models' }).click();
    await page.getByLabel('Available chat models', { exact: true }).selectOption('test/remote');
    await page.getByRole('button', { name: 'Save generation settings' }).click();
    await nav('Documentation'); await page.getByRole('button', { name: 'Generate / resume documentation' }).click();
    await expect(page.getByTestId('docs-state')).toHaveText('partial', { timeout: 30000 });
    await page.getByRole('button', { name: /Remote documentation/ }).click(); await expect(page.getByText('The captured source defines helper.', { exact: false })).toBeVisible();
    await nav('Chat'); await page.getByLabel('Repository question', { exact: true }).fill('Explain helper'); await page.getByRole('button', { name: 'Ask repository', exact: true }).click();
    await expect(page.getByTestId('chat-state')).toHaveText('ready', { timeout: 15000 }); await expect(page.locator('.chat-answer')).toContainText('OpenRouter');
    await nav('Settings'); await page.getByLabel('Model provider', { exact: true }).selectOption('ollama');
    await expect(page.getByLabel('Ollama model ID', { exact: true })).toHaveValue('test:local');
    await page.getByRole('button', { name: 'Save generation settings' }).click();
    await nav('Documentation'); await page.getByRole('button', { name: 'Generate / resume documentation' }).click();
    await expect(page.getByRole('button', { name: /Local documentation/ })).toBeVisible({ timeout: 30000 });
    await nav('Settings'); await page.getByLabel('Model provider', { exact: true }).selectOption('openrouter');
    await expect(page.getByLabel('OpenRouter model ID', { exact: true })).toHaveValue('test/remote');
    await page.getByRole('button', { name: 'Save generation settings' }).click();
    await page.screenshot({ path: 'test-results/dual-providers.png', fullPage: true });
    await app.close(); app = await electron.launch({ args: ['.'], cwd: resolve('.'), env }); page = await app.firstWindow();
    await nav('Settings'); await expect(page.getByLabel('Model provider', { exact: true })).toHaveValue('openrouter'); await expect(page.getByTestId('credential-state')).toHaveText('Key saved');
  } finally { await app.close(); }
});
