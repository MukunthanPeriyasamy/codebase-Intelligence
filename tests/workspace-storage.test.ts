import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { RepositoryService } from '../src/main/repositories';
import { createProject, exportMarkdown } from '../src/main/workspace';
import { DOC_VERSION, type DocPage } from '../src/shared/documentation';
import { actionSchema } from '../src/shared/contracts';
import { python, temporary } from './helpers';

test('chosen workspace persists, contains clone and source, and preserves earlier exports on commit and folder changes', { timeout: 90000 }, async () => {
  const source = await temporary('workspace-input-'); const directory = await temporary('workspace-state-'); const folder = await temporary('workspace-selected-');
  const exec = promisify(execFile);
  const git = async (...args: string[]) => (await exec('git', ['-C', source, '-c', 'user.name=Workspace Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main'); await writeFile(join(source, 'main.py'), 'def original():\n    return 1\n'); await git('add', '.'); await git('commit', '-m', 'first');
  const options = { directory, python, script: resolve('worker/snapshot.py') };
  let repo = new RepositoryService(options, () => {});
  try {
    await repo.initialize(); await repo.chooseWorkspace(folder); await repo.connect('local', source, ''); await repo.settle();
    assert.equal(repo.status.phase, 'ready', repo.status.error ?? '');
    const first = repo.status.repository!; assert.ok(first.workspacePath?.startsWith(folder)); assert.ok(first.sourceFolder);
    await access(join(first.workspacePath!, '.codebase-intelligence', 'mirror.git', 'HEAD'));
    assert.match(await readFile(join(first.sourceFolder!, 'main.py'), 'utf8'), /original/);
    await writeFile(join(first.sourceFolder!, 'personal.txt'), 'preserve my copy');
    await writeFile(join(source, 'main.py'), 'def updated():\n    return 2\n'); await git('add', '.'); await git('commit', '-m', 'second');
    repo.sync(); await repo.settle(); assert.equal(repo.status.phase, 'ready', repo.status.error ?? '');
    assert.notEqual(repo.status.repository!.sourceFolder, first.sourceFolder);
    assert.equal(await readFile(join(first.sourceFolder!, 'personal.txt'), 'utf8'), 'preserve my copy');
    await repo.setAuto(false); await repo.close(); repo = new RepositoryService(options, () => {}); await repo.initialize();
    assert.equal(repo.status.workspaceFolder, folder); assert.equal(repo.status.repository?.workspacePath, first.workspacePath);
    const nextFolder = await temporary('workspace-second-'); await repo.chooseWorkspace(nextFolder);
    assert.ok(repo.status.repository?.workspacePath?.startsWith(nextFolder));
    await access(join(first.sourceFolder!, 'personal.txt'));
    assert.match(await readFile(join(repo.status.repository!.sourceFolder!, 'main.py'), 'utf8'), /updated/);
  } finally { await repo.close(); }
});

test('Markdown exports retain complete generations and personal notes with safe generated paths', async () => {
  const folder = await temporary('markdown-workspace-'); const project = await createProject(folder, '../../CON');
  await writeFile(join(project, 'notes', 'mine.md'), '# Personal');
  const page: DocPage = { id: 'a'.repeat(64), repoId: randomUUID(), commit: 'b'.repeat(40), model: 'test/model', servedModel: 'test/model', promptVersion: DOC_VERSION, analyzer: 'fixture', kind: 'module', evidence: [], inputHash: 'c'.repeat(64), created: new Date().toISOString(), cost: 0, content: { title: '../Title <script>', sections: [{ title: 'Function', kind: 'function', symbolId: 'fixture', claims: [{ text: 'An interpretation.', basis: 'uncertain', citations: [] }] }], gaps: ['Incomplete fixture'] } };
  await exportMarkdown(project, page.commit, [page], 2, 1);
  const before = await readFile(join(project, 'docs', 'README.md'), 'utf8'); assert.match(before, /2 remaining/);
  const versions = await readdir(join(project, 'docs', 'versions')); const version = versions[0]!;
  const text = await readFile(join(project, 'docs', 'versions', version, 'modules', `${page.id}.md`), 'utf8');
  assert.match(text, /uncertain/); assert.match(text, /Incomplete fixture/); assert.match(text, /Commit: b{40}/);
  await access(join(project, 'docs', 'versions', version, 'functions', `${page.id}-0.md`));
  await exportMarkdown(project, page.commit, [], 0, 0);
  assert.equal((await readdir(join(project, 'docs', 'versions'))).length, 2);
  assert.equal(await readFile(join(project, 'notes', 'mine.md'), 'utf8'), '# Personal');
  assert.equal(actionSchema.safeParse({ type: 'workspace.choose', path: 'C:/arbitrary' }).success, false);
  assert.equal(actionSchema.safeParse({ type: 'workspace.open', path: 'C:/arbitrary' }).success, false);
});
