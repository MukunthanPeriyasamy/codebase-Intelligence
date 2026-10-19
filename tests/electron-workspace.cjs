const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Workspace } = require('../electron/workspace.cjs');

test('workspace read/save, conflicts, binary files and path boundaries', async () => {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.local', 'workspace-test-'));
  await fs.writeFile(path.join(root, 'hello.ts'), 'const hello = 1;\r\n');
  const workspace = new Workspace();
  const selected = await workspace.select(root);
  const request = { workspace: selected.root, relative: 'hello.ts' };
  const initial = await workspace.read(request);
  assert.equal(initial.text, 'const hello = 1;\r\n');
  await workspace.save({ ...request, hash: initial.hash, text: 'const hello = 2;\r\n' });
  await assert.rejects(workspace.save({ ...request, hash: initial.hash, text: 'stale' }), /changed on disk/);
  await assert.rejects(workspace.read({ ...request, relative: '../package.json' }), /outside/);
  await assert.rejects(workspace.read({ ...request, workspace: root + 'wrong' }), /Workspace changed/);
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1]));
  await assert.rejects(workspace.read({ ...request, relative: 'binary' }), /Binary/);
  await workspace.create({ workspace: root, relative: 'new.ts' });
  await assert.rejects(workspace.create({ workspace: root, relative: 'new.ts' }));
  await assert.rejects(workspace.create({ workspace: root, relative: '../../outside.ts' }), /outside/);
  const exported = await workspace.exportDocument({ workspace: root, text: '# Documentation\n\nReference code' });
  assert.equal(await fs.readFile(path.join(root, exported.relative), 'utf8'), '# Documentation\n\nReference code');
  const second = await workspace.exportDocument({ workspace: root, text: '# New version' });
  assert.notEqual(exported.relative, second.relative);
  await assert.rejects(workspace.exportDocument({ workspace: root + 'wrong', text: 'test' }), /Workspace changed/);
});
