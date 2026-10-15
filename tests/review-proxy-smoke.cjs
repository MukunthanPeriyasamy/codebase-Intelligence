// Run with the frontend on 3000 and review-proxy-fixture.py on 8001.
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const p = JSON.parse(fs.readFileSync('.local/review-proxy-result.json', 'utf8'));
  const url = 'http://127.0.0.1:3000/api/chat/changes';
  const body = JSON.stringify({ action: 'accept', proposal_id: p.id });
  for (const origin of [undefined, 'https://evil.example', 'http://localhost:3000']) {
    const response = await fetch(url, { method: 'POST', body, headers: {
      'Content-Type': 'application/json', 'X-DeepWiki-Review': '1', ...(origin ? { Origin: origin } : {}),
    } });
    assert.equal(response.status, 403);
    assert.equal(fs.readFileSync(p.root + '/sample.txt', 'utf8'), 'before\n');
  }
  const response = await fetch(url, { method: 'POST', body, headers: {
    'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000', 'X-DeepWiki-Review': '1',
  } });
  const result = await response.text();
  assert.equal(response.status, 200, result);
  assert.equal(JSON.parse(result).status, 'accepted');
  assert.equal(fs.readFileSync(p.root + '/sample.txt', 'utf8'), 'after\n');
  console.log('PASS: real Next proxy -> FastAPI -> isolated fixture file; absent, foreign and mismatched origins refused.');
})().catch(error => { console.error(error); process.exitCode = 1; });
