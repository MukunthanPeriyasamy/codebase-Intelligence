// Exercise the installed Mermaid parser and SVG renderer in a real browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { chromium } = require('../.local/ui-test/node_modules/playwright');
const compiled = ts.transpileModule(fs.readFileSync('src/utils/mermaidSource.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText;
const exportsObject = {};
new Function('exports', compiled)(exportsObject);
const repair = exportsObject.quoteNestedRoundLabels;
const broken = 'graph TD;\n A(User prompt) --> B(Document chunks);\n B --> C(Codebase);\n C --> D(Analyze);\n D --> E(LLM (Groq));\n E --> F(Review);';
assert.ok(repair(broken).includes('E("LLM (Groq)")'));
for (const unchanged of [
  'graph TD; A("LLM (Groq)") --> B[Done]',
  'graph TD; A((Circle)) --> B([Stadium])',
  'sequenceDiagram\n A->>B: LLM (Groq)',
  'graph TD\n %% E(LLM (Groq))\n A --> B',
  'graph TD; A["literal E(LLM (Groq))"]',
  'graph TD; A(unclosed (label)',
]) assert.equal(repair(unchanged), unchanged);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.setContent('<main></main>');
    await page.addScriptTag({ path: 'node_modules/mermaid/dist/mermaid.min.js' });
    const result = await page.evaluate(async ({ broken, repaired }) => {
      mermaid.initialize({ startOnLoad: false, logLevel: 'fatal', suppressErrorRendering: true });
      const invalid = await mermaid.parse(broken, { suppressErrors: true });
      const valid = await mermaid.parse(repaired, { suppressErrors: true });
      const { svg } = await mermaid.render('regression', repaired);
      document.querySelector('main').innerHTML = svg;
      const unsupported = await mermaid.parse('graph TD; A[unfinished', { suppressErrors: true });
      return { invalid, valid: !!valid, unsupported, label: document.querySelector('main').textContent };
    }, { broken, repaired: repair(broken) });
    assert.equal(result.invalid, false);
    assert.equal(result.valid, true);
    assert.equal(result.unsupported, false);
    assert.ok(result.label.includes('LLM (Groq)'));
    assert.deepEqual(errors, []);
    console.log('PASS: reported diagram renders, label preserved, valid syntax unchanged, invalid syntax fails validation without console errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
