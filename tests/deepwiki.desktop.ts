import { test, expect, _electron as electron } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { python, temporary } from './helpers';

test('Electron uses DeepWiki indexing/context, keeps KG and opens committed citations', async () => {
  test.setTimeout(180000);
  const source = await temporary('deepwiki-desktop-source-'); const data = await temporary('deepwiki-desktop-');
  const exec = promisify(execFile);
  const git = async (...args: string[]) => exec('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true });
  await git('init', '-b', 'main');
  await writeFile(join(source, 'main.py'), 'def receive():\n    return "incoming payload"\ndef entry():\n    return receive()\n');
  await git('add', '.'); await git('commit', '-m', 'fixture');
  // Dirty working tree must not reach embeddings or answers.
  await writeFile(join(source, 'main.py'), 'def dirty():\n    return "UNCOMMITTED_SENTINEL"\n');
  const env = { ...process.env, CODEBASE_INTELLIGENCE_DATA_DIR: data, CODEBASE_INTELLIGENCE_PYTHON: python,
    CODEBASE_INTELLIGENCE_DEEPWIKI_HOME: resolve('.local/deepwiki-tool') } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init?.body as string ?? '{}');
        if (String(url).endsWith('/api/show')) return Response.json({ capabilities: [body.model === 'fixture-embed' ? 'embedding' : 'completion'] });
        if (String(url).endsWith('/api/embed')) {
          if (body.input.some((text: string) => text.includes('UNCOMMITTED_SENTINEL'))) throw new Error('Dirty source escaped');
          return Response.json({ embeddings: body.input.map(() => [1, 0, 0]) });
        }
        if (String(url).endsWith('/api/chat')) {
          const prompt = JSON.parse(body.messages[1].content) as string;
          const context = JSON.parse(prompt.split('<START_OF_CONTEXT>\n')[1]!.split('\n<END_OF_CONTEXT>')[0]!);
          if (prompt.includes('UNCOMMITTED_SENTINEL')) throw new Error('Dirty source escaped');
          const item = context.evidence[0];
          const content = { sufficient: true, gaps: [], content: { title: 'Repository input', gaps: [], sections: [{ title: 'Input', kind: 'module', symbolId: null, claims: [{ text: 'The captured source defines the receive function.', basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start, end: item.start, quote: item.text.split('\n')[0] }] }] }] } };
          return Response.json({ model: 'fixture-chat', done: true, done_reason: 'stop', message: { content: JSON.stringify(content) } });
        }
        throw new Error('Unexpected provider request');
      };
    }, source);
    await page.getByRole('button', { name: 'Choose repository folder' }).click();
    await expect(page.getByTestId('sync-phase')).toHaveText('ready', { timeout: 45000 });
    const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
    await nav.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Ollama model ID', { exact: true }).fill('fixture-chat');
    await page.getByLabel('Ollama embedding model ID', { exact: true }).fill('fixture-embed');
    await page.getByRole('button', { name: 'Save generation settings' }).click();
    await page.getByRole('button', { name: 'Build / resume code index' }).click();
    await expect.poll(async () => { const status = await page.evaluate(() => window.desktop.status()); return status.ok ? status.status.vectors?.phase : 'error'; }, { timeout: 60000 }).toBe('ready');
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByLabel('Repository question', { exact: true }).fill('What inputs does this repository handle?');
    await page.getByRole('button', { name: 'Ask repository', exact: true }).click();
    await expect(page.getByTestId('chat-state')).toHaveText('ready', { timeout: 45000 });
    await expect(page.locator('.chat-answer')).toContainText('The captured source defines the receive function.');
    await expect(page.locator('.answer-quality')).toContainText('Codebase');
    await page.getByRole('button', { name: 'main.py:1–1', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('def receive():');
    await page.keyboard.press('Escape');
    await nav.getByRole('button', { name: 'Repository', exact: true }).click();
    await page.getByRole('button', { name: 'Knowledge Graph', exact: true }).click();
    // Both the definition and the unresolved call site appear in the graph.
    await expect(page.locator('.react-flow__node').filter({ hasText: 'receive' })).toHaveCount(2, { timeout: 15000 });
  } finally { await app.close(); }
});
