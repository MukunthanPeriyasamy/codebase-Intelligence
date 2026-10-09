import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RepositoryService } from '../src/main/repositories';
import { branchSchema, remoteSchema } from '../src/shared/repository';
import { buildSnapshot } from '../src/main/snapshot';
import { python, temporary } from './helpers';

const exec = promisify(execFile);
async function fixtureGit(repo: string, ...args: string[]) {
  const { stdout } = await exec('git', ['-C', repo, '-c', 'user.name=Phase3 Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { windowsHide: true });
  return stdout.trim();
}
async function fixture() {
  const source = await temporary('source-');
  await fixtureGit(source, 'init', '-b', 'main');
  await writeFile(join(source, 'app.py'), 'def helper():\n    return 1\ndef entry():\n    return helper()\n');
  await writeFile(join(source, 'keep.ts'), 'export function stable() { return 1; }\n');
  await writeFile(join(source, 'rename.py'), 'def renamed():\n    return 123456789\n');
  await writeFile(join(source, 'delete.txt'), 'delete me\n');
  await writeFile(join(source, 'README.md'), '# Fixture\n');
  await fixtureGit(source, 'add', '.'); await fixtureGit(source, 'commit', '-m', 'initial');
  return source;
}
async function saved(directory: string) { return JSON.parse(await readFile(join(directory, 'repository-state.json'), 'utf8')) as { config: { id: string; activeDirectory: string; active: { commit: string } } }; }
async function inventory(directory: string, id: string, version: string): Promise<Array<{path: string; hash: string | null; status: string; symbols: string}>> {
  const { stdout } = await exec(python, ['-I', '-c', 'import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute("SELECT path,hash,status,symbols FROM files ORDER BY path")]))', join(directory, 'repositories', id, 'snapshots', version, 'index.sqlite3')], { windowsHide: true });
  return JSON.parse(stdout);
}
test('repository inputs reject command revisions and credential-bearing URLs', () => {
  for (const branch of ['--upload-pack=evil', 'main~1', 'main:other', '../main', 'main\nother', 'main@{1}']) assert.equal(branchSchema.safeParse(branch).success, false);
  for (const url of ['ext::evil', 'file:///secrets', 'https://token@host/repo', 'ssh://user:password@host/repo', 'https://host/repo?token=x']) assert.equal(remoteSchema.safeParse(url).success, false);
  for (const url of ['https://github.com/owner/repo.git', 'git@github.com:owner/repo.git', 'ssh://git@host/owner/repo.git']) assert.equal(remoteSchema.safeParse(url).success, true);
});
test('real clone and commit sync preserve dirty source, reuse files, publish atomically and persist notices', { timeout: 90000 }, async () => {
  const source = await fixture(); const directory = await temporary('repository-service-');
  const options = { directory, python, script: resolve('worker/snapshot.py'), intervalMs: 60000 };
  let service = new RepositoryService(options, () => {});
  try {
    await service.initialize();
    const head = await fixtureGit(source, 'rev-parse', 'HEAD');
    await writeFile(join(source, 'app.py'), 'def dirty_only(): pass\n');
    await writeFile(join(source, 'untracked.py'), 'def not_committed(): pass\n');
    await service.connect('local', source, ''); await service.settle();
    assert.equal(service.status.phase, 'ready', service.status.error ?? '');
    assert.equal(service.status.repository?.active?.commit, head);
    assert.equal(service.status.repository?.active?.files, 5);
    assert.ok((service.status.repository?.active?.parsed ?? 0) >= 3);
    const first = (await saved(directory)).config;
    const before = await inventory(directory, first.id, first.activeDirectory);
    assert.equal(before.some(file => file.path === 'untracked.py'), false);
    const app = before.find(file => file.path === 'app.py')!;
    assert.ok(app.symbols.includes('helper')); assert.equal(app.symbols.includes('dirty_only'), false);
    const blobPath = join(directory, 'repositories', first.id, 'snapshots', first.activeDirectory, 'blobs', app.hash!);
    const oldBytes = await readFile(blobPath, 'utf8');
    const noticeCount = service.status.notices.length;
    service.sync(); await service.settle();
    assert.equal(service.status.notices.length, noticeCount);
    assert.equal((await saved(directory)).config.activeDirectory, first.activeDirectory);
    await writeFile(join(source, 'app.py'), 'def helper():\n    return 2\ndef entry():\n    return helper()\n');
    await rename(join(source, 'rename.py'), join(source, 'renamed.py'));
    await unlink(join(source, 'delete.txt'));
    await writeFile(join(source, 'added.go'), 'package fixture\nfunc Added() int { return 7 }\n');
    await fixtureGit(source, 'add', 'app.py', 'rename.py', 'renamed.py', 'delete.txt', 'added.go');
    await fixtureGit(source, 'commit', '-m', 'add edit rename delete');
    const next = await fixtureGit(source, 'rev-parse', 'HEAD');
    await writeFile(join(source, 'app.py'), 'def dirty_after_commit(): pass\n');
    const dirtyBefore = await fixtureGit(source, 'status', '--porcelain');
    service.sync(); assert.equal(service.status.repository?.active?.commit, head);
    await service.settle();
    assert.equal(service.status.phase, 'ready', service.status.error ?? '');
    const update = service.status.repository!.active!;
    assert.equal(update.commit, next);
    assert.deepEqual([update.added, update.modified, update.renamed, update.deleted], [1, 1, 1, 1]);
    assert.equal(update.reused, 2); assert.ok(update.affected >= 5);
    assert.equal(await readFile(blobPath, 'utf8'), oldBytes);
    assert.equal(await fixtureGit(source, 'status', '--porcelain'), dirtyBefore);
    const current = (await saved(directory)).config;
    const files = await inventory(directory, current.id, current.activeDirectory);
    assert.equal(files.some(file => ['delete.txt', 'rename.py', 'untracked.py'].includes(file.path)), false);
    assert.ok(files.find(file => file.path === 'renamed.py')?.symbols.includes('renamed.py::'));
    assert.equal(service.status.notices.filter(notice => notice.kind === 'success').length, 2);
    await service.markRead(); assert.equal(service.status.notices.some(notice => !notice.read), false);
    await service.close();
    // Simulate a process crash after pointer publication but before settings save.
    const stale = await saved(directory);
    stale.config.active = first.active; stale.config.activeDirectory = first.activeDirectory;
    await writeFile(join(directory, 'repository-state.json'), JSON.stringify(stale));
    service = new RepositoryService(options, () => {});
    await service.initialize(); await service.settle();
    assert.equal(service.status.repository?.active?.commit, next);
    assert.equal(service.status.notices.some(notice => !notice.read), false);
    // Rewinding the fixture's branch must not silently publish an older commit.
    await fixtureGit(source, 'update-ref', 'refs/heads/main', head);
    service.sync(); await service.settle();
    assert.equal(service.status.phase, 'error'); assert.equal(service.status.repository?.active?.commit, next);
  } finally { await service.close(); }
});
test('snapshot cancellation leaves a resumable checkpoint and never follows symlinks', { timeout: 90000 }, async () => {
  const source = await fixture(); const root = await temporary('resume-');
  for (let index = 0; index < 40; index++) await writeFile(join(source, `file-${index}.txt`), `committed ${index}\n`);
  await fixtureGit(source, 'add', '.'); await fixtureGit(source, 'commit', '-m', 'many files');
  const commit = await fixtureGit(source, 'rev-parse', 'HEAD');
  const mirror = join(root, 'mirror.git');
  await exec('git', ['clone', '--bare', '--no-local', source, mirror], { windowsHide: true });
  const request = { mirror, stage: join(root, 'stage'), previous: null, commit, base: null };
  const controller = new AbortController();
  await assert.rejects(buildSnapshot(python, resolve('worker/snapshot.py'), request, controller.signal, done => { if (done >= 1) controller.abort(); }));
  const completed = await buildSnapshot(python, resolve('worker/snapshot.py'), request, new AbortController().signal, () => {});
  assert.equal(completed.files, 45); assert.ok(completed.reused > 0);
  // Symlinks can be created in Git's index without Windows symlink privileges.
  const linkText = join(root, 'link-target.txt'); await writeFile(linkText, '/outside/secret');
  const linkBlob = await fixtureGit(source, 'hash-object', '-w', linkText);
  await fixtureGit(source, 'update-index', '--add', '--cacheinfo', `120000,${linkBlob},outside-link`);
  await fixtureGit(source, 'commit', '-m', 'symlink object');
  const linkedCommit = await fixtureGit(source, 'rev-parse', 'HEAD');
  await exec('git', ['-C', mirror, 'fetch', source, '+refs/heads/main:refs/heads/main'], { windowsHide: true });
  const linked = await buildSnapshot(python, resolve('worker/snapshot.py'), { ...request, stage: join(root, 'linked'), previous: request.stage, commit: linkedCommit, base: commit }, new AbortController().signal, () => {});
  assert.equal(linked.files, 46); assert.equal(linked.excluded, 1);
});
test('automatic timer detects commits without manual sync; cancellation pauses auto-sync', { timeout: 90000 }, async () => {
  const source = await fixture(); const directory = await temporary('auto-');
  const service = new RepositoryService({ directory, python, script: resolve('worker/snapshot.py'), intervalMs: 150 }, () => {});
  try {
    await service.initialize(); await service.connect('local', source, 'main'); await service.settle();
    const initial = service.status.repository?.active?.commit;
    await writeFile(join(source, 'README.md'), '# New commit\n');
    await fixtureGit(source, 'add', 'README.md'); await fixtureGit(source, 'commit', '-m', 'auto update');
    const deadline = Date.now() + 30000;
    while (service.status.repository?.active?.commit === initial) { if (Date.now() > deadline) throw new Error(service.status.error ?? 'Auto sync timeout'); await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(service.status.repository?.active?.commit, await fixtureGit(source, 'rev-parse', 'HEAD'));
    await service.cancel(); assert.equal(service.status.repository?.autoSync, false);
    await service.disconnect(); assert.equal(service.status.repository, null);
  } finally { await service.close(); }
});
