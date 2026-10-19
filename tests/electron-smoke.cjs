const { _electron } = require('../.local/ui-test/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const folder = fs.mkdtempSync(path.join(root, '.local', 'desktop-smoke-'));
  fs.writeFileSync(path.join(folder, 'hello.ts'), 'export const greeting = "Hello desktop";\n');
  const env = { ...process.env, DEEPWIKI_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'electron/main.cjs'), `--user-data-dir=${path.join(folder, 'electron-profile')}`], env, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    await page.waitForURL('**/desktop', { timeout: 240000 });
    await page.getByRole('heading', { name: 'A clearer view of what you’re building.' }).waitFor();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.getByRole('button', { name: 'Open folder', exact: false }).first().click();
    await page.getByRole('button', { name: 'hello.ts', exact: true }).click();
    await page.locator('.monaco-editor textarea').first().waitFor({ timeout: 60000 });
    await page.locator('.monaco-editor textarea').first().focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('// saved from desktop');
    await page.keyboard.press('Control+s');
    await page.getByText('Saved hello.ts', { exact: true }).waitFor();
    assert.match(fs.readFileSync(path.join(folder, 'hello.ts'), 'utf8'), /saved from desktop/);
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await page.getByRole('textbox', { name: 'New entry path' }).fill('created.py');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'created.py', exact: true }).first().waitFor();
    assert.ok(fs.existsSync(path.join(folder, 'created.py')));
    let generation;
    await page.route('**/api/auth/status', route => route.fulfill({ json: { auth_required: false } }));
    await page.route('**/api/wiki/tasks', async route => {
      generation = route.request().postDataJSON();
      await route.fulfill({ json: { task_id: 'desktop-settings-test', status: 'pending', created: true } });
    });
    await page.route('**/api/wiki/tasks/desktop-settings-test', route => route.fulfill({ json: {
      id: 'desktop-settings-test', status: 'completed', pages_done: 1, pages_total: 1, error: null,
      pipeline: [{ id: 'save', label: 'Save documentation', state: 'completed', detail: 'Ready' }],
    } }));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Generation model', { exact: true }).fill('desktop-test-model');
    await page.getByRole('textbox', { name: 'Ollama embedding model' }).fill('nomic-embed-text');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Document generation', exact: true }).click();
    await page.getByRole('button', { name: 'Generate documentation', exact: true }).click();
    await page.getByText('Documentation and its search index are ready.', { exact: true }).waitFor();
    assert.equal(generation.repo_url, folder);
    assert.equal(generation.model, 'desktop-test-model');
    assert.equal(generation.embedding_model, 'nomic-embed-text');
    await page.route('**/api/wiki_cache?**', route => route.fulfill({ json: {
      repo: { type: 'local', repoUrl: folder }, wiki_structure: { title: 'Test documentation' },
      generated_pages: { overview: { title: 'Overview', content: 'Document preview test content.' } },
      document_index: { status: 'ready', chunk_count: 1, embedding_model: 'nomic-embed-text' },
    } }));
    await page.getByRole('button', { name: 'Preview saved documentation' }).click();
    await page.getByText('Document preview test content.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save Markdown to workspace' }).click();
    await page.getByText(/Saved deepwiki-document-/).waitFor();
    const exported = fs.readdirSync(folder).find(name => name.startsWith('deepwiki-document-'));
    assert.ok(exported);
    assert.match(fs.readFileSync(path.join(folder, exported), 'utf8'), /Document preview test content/);
    await page.screenshot({ path: path.join(root, '.local/desktop-settings.png') });
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: /ollama\/desktop-test-model/ }).waitFor();
    let kgRequest;
    await page.route('**/api/kg', async route => {
      kgRequest = route.request().postDataJSON();
      await route.fulfill({ json: { workspace: folder, answer: 'The graph links run to greet.', evidence: [{ tool: 'find_code' }] } });
    });
    await page.getByRole('button', { name: /^Fast/ }).click();
    await page.getByRole('button', { name: /Knowledge Graph/ }).click();
    await page.getByPlaceholder(/Ask about functions/).fill('Who calls greet?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.getByText('The graph links run to greet.', { exact: true }).waitFor();
    assert.equal(kgRequest.workspace, folder);
    assert.equal(kgRequest.question, 'Who calls greet?');
    await page.getByRole('button', { name: /Knowledge Graph/ }).click();
    await page.getByRole('button', { name: /Edit code/ }).click();
    await page.locator('.editor-panel .review-surface').getByRole('heading', { name: 'Review changes' }).waitFor();
    await page.getByRole('button', { name: 'Close diff panel' }).click();
    await page.screenshot({ path: path.join(root, '.local/desktop-smoke.png') });
    console.log('Desktop, editor, settings persistence, generation request/progress, chat model, KG routing and review panel passed (model/generation responses mocked).');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
