// Deterministic browser regression: no provider calls or user repository writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../.local/ui-test/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const proposals = new Map();
  const requests = [];
  let decisions = 0;
  let missingDocs = false;
  const wikiPage = { id: 'overview', title: 'Overview', content: 'A sample repository.', filePaths: ['main.py'], importance: 'high', relatedPages: [] };
  await page.route('**/api/wiki_cache?*', route => route.fulfill({ json: {
    provider: 'ollama', model: 'qwen3:8b',
    wiki_structure: { id: 'wiki', title: 'Sample', description: 'Sample repository', pages: [wikiPage], sections: [{ id: 'main', title: 'Main', pages: ['overview'], subsections: [] }], rootSections: ['main'] },
    generated_pages: { overview: wikiPage },
  } }));
  await page.route('**/api/auth/status', route => route.fulfill({ json: { auth_required: false } }));
  await page.route('**/api/lang/config', route => route.fulfill({ json: { default: 'en', supported_languages: { en: 'English' } } }));
  await page.route('**/api/models/config', route => route.fulfill({ json: { defaultProvider: 'ollama', providers: [{ id: 'ollama', name: 'Ollama', models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }] }] } }));
  await page.route('**/api/chat/changes', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'propose') {
      requests.push(body.request);
      if (missingDocs) {
        await route.fulfill({ status: 400, json: { detail: 'No document Found Generate One' } });
        return;
      }
      const p = { id: String(proposals.size + 1).padStart(32, '0'), summary: 'Update the default value.', documents: [{page_id: 'overview', title: 'Overview', chunk: 1, files: ['main.py']}], root: 'D:/sample-repository', status: 'pending', files: [{ path: 'main.py', before: 'value = 1\n', after: 'value = 2\n', diff: '--- a/main.py\n+++ b/main.py\n@@ -1 +1 @@\n-value = 1\n+value = 2\n' }] };
      proposals.set(p.id, p);
      await route.fulfill({ json: p });
    } else {
      const p = proposals.get(body.proposal_id);
      if (body.action !== 'get') { decisions++; p.status = body.action === 'accept' ? 'accepted' : 'rejected'; }
      await route.fulfill({ json: p });
    }
  });
  await page.routeWebSocket('**/ws/chat', ws => ws.onMessage(message => {
    requests.push(JSON.parse(String(message)));
    ws.send(missingDocs ? 'No document Found Generate One' : 'The value is defined in main.py.');
    ws.close();
  }));
  const url = (repo = 'sample') => `http://127.0.0.1:3000/test/${repo}?type=local&local_path=${encodeURIComponent(`D:/fixture/${repo}`)}&provider=ollama&model=qwen3:8b`;
  const openChat = async () => page.getByRole('button', { name: /Ask about this repository/i }).click();
  const input = () => page.locator('input').filter({ visible: true }).first();
  const chooseMode = async mode => {
    await page.getByRole('button', { name: /^(Fast|Edit code|Deep Research|Codemap)$/ }).click();
    await page.getByRole('button', { name: mode }).last().click();
  };
  await page.goto(url());
  await openChat();
  await chooseMode(/Edit code Propose changes/);
  await input().fill('Change the default to 2');
  await input().press('Enter');
  await page.getByRole('button', { name: 'Accept', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('aside button:last-child')?.disabled);
  assert.equal(decisions, 0);
  await page.getByText('Documentation used (1 chunks)').waitFor();
  const aside = page.getByRole('complementary', { name: 'Proposed code changes' });
  const widths = await aside.evaluate(el => ({ right: el.parentElement.getBoundingClientRect().width, left: el.parentElement.previousElementSibling.getBoundingClientRect().width }));
  assert.ok(Math.abs(widths.left - widths.right) < 2, JSON.stringify(widths));
  fs.mkdirSync('.local', { recursive: true });
  await page.screenshot({ path: '.local/chat-review.png' });
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByText('1 file(s) · rejected').waitFor();
  await input().fill('Try the change again');
  await input().press('Enter');
  await page.getByText('1 file(s) · pending').waitFor();
  assert.ok(requests.at(-1).messages.some(m => m.content.includes('Change the default')));
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByText('1 file(s) · accepted').waitFor();
  assert.equal(decisions, 2);
  await input().fill('unsent draft');
  await page.reload();
  await openChat();
  await page.getByText('1 file(s) · accepted').waitFor();
  assert.equal(await input().inputValue(), 'unsent draft');
  assert.equal(decisions, 2, 'Restoring a proposal must never accept it');
  await page.getByRole('button', { name: 'Chat history', exact: true }).click();
  await page.getByRole('button', { name: '+ New chat', exact: true }).click();
  assert.equal(await input().inputValue(), '');
  await page.getByRole('button', { name: 'Chat history', exact: true }).click();
  await page.getByRole('button', { name: /Change the default to 2/ }).click();
  await page.getByText('1 file(s) · accepted').waitFor();
  assert.equal(await input().inputValue(), 'unsent draft');
  await chooseMode(/Fast Quick and responsive/);
  await input().fill('Where is that value?');
  await input().press('Enter');
  await page.getByText('The value is defined in main.py.').waitFor();
  assert.ok(requests.at(-1).messages.length >= 5, 'Restored turns must be sent as context');
  await page.reload(); await openChat();
  await page.getByText('The value is defined in main.py.').waitFor();
  await page.goto(url('other')); await openChat();
  assert.equal(await page.getByText('The value is defined in main.py.').count(), 0, 'Repository histories must be isolated');
  await page.addInitScript(() => localStorage.setItem('deepwiki-chat-v1:local:D:/fixture/other', JSON.stringify({ activeId: 'research', chats: [{
    id: 'research', title: 'Saved research and map', updated: new Date().toISOString(), snapshot: { draft: '', mode: 'fast', turns: [
      { kind: 'chat', question: 'Research question', response: 'Final saved finding', mode: 'deep_research', stageIndex: 1, researchStages: [
        { title: 'Plan', content: 'Saved research plan', iteration: 1, type: 'plan' },
        { title: 'Conclusion', content: 'Final saved finding', iteration: 2, type: 'conclusion' },
      ] },
      { kind: 'codemap', question: 'Map question', data: { title: 'Saved codemap', summary: 'Saved map summary', sections: [] } },
    ] },
  }] })));
  await page.reload(); await openChat();
  await page.getByText('Final saved finding').waitFor();
  await page.getByText('Saved codemap', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Previous stage', exact: true }).click();
  await page.getByText('Saved research plan').waitFor();
  missingDocs = true;
  await chooseMode(/Edit code Propose changes/);
  await input().fill('Change theme colors'); await input().press('Enter');
  await page.getByRole('alert').filter({ hasText: 'No document Found Generate One' }).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Accept', exact: true}).isDisabled(), true);
  assert.equal(decisions, 2);
  await chooseMode(/Deep Research/);
  const beforeResearch = requests.length;
  await input().fill('Explain theme colors'); await input().press('Enter');
  await page.waitForTimeout(2500);
  assert.equal(requests.length, beforeResearch + 1, 'Missing documentation must not auto-continue research');
  assert.deepEqual(errors, []);
  console.log('PASS: 50/50 diff, explicit accept/reject, restored proposals/draft, new/select chat, follow-up context, reload, repository isolation.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
