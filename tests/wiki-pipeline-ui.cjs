const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const file = path.resolve('src/components/WikiPipelineProgress.tsx');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const loaded = new Module(file, module);
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(compiled, file);
const Component = loaded.exports.default;
const render = progress => renderToStaticMarkup(React.createElement(Component, { progress }));
assert.match(render(null), /Detect application profiles/);
const pipeline = [
  { id: 'repository', label: 'Prepare repository', state: 'completed', detail: '' },
  { id: 'pages', label: 'Generate pages', state: 'active', detail: '' },
  { id: 'save', label: 'Save documentation', state: 'pending', detail: '' },
];
const progress = { pipeline, status: 'generating', pages_done: 2, pages_total: 5 };
assert.match(render(progress), /2 \/ 5 pages processed/);
assert.match(render(progress), /aria-current="step"/);
const failed = render({ ...progress, status: 'failed', error: 'Model unavailable', pipeline: pipeline.map(s => s.id === 'pages' ? { ...s, state: 'failed' } : s) });
assert.match(failed, /Not reached/);
assert.match(failed, /Model unavailable/);
assert.match(failed, /open=""/);
const done = render({ ...progress, status: 'completed', pipeline: pipeline.map(s => ({ ...s, state: 'completed' })) });
assert.match(done, /Documentation saved successfully/);
assert.doesNotMatch(done, /open=""/);
console.log('Pipeline UI states passed');
