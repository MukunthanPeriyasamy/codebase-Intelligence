import { createProject, workspaceDirectory, ownedDirectory, exportSource } from './workspace';
import { mkdir, readFile, realpath, rename, writeFile, access, cp, lstat } from 'node:fs/promises';
import { basename, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { branchSchema, remoteSchema, repositoryViewSchema, noticeSchema, snapshotSchema, type RepositoryStatus } from '../shared/repository';
import { git, RepoError } from './git';
import { buildSnapshot } from './snapshot';
import type { SnapshotRef } from '../shared/documentation';

const configSchema = repositoryViewSchema.extend({ source: z.string().max(8192), pendingCommit: z.string().regex(/^[a-f0-9]{40,64}$/).nullable(), activeDirectory: z.string().regex(/^[a-f0-9]{40,64}-[a-f0-9-]{36}$/).nullable() }).strict();
const savedSchema = z.object({ version: z.literal(1), workspaceFolder: z.string().max(8192).optional(), config: configSchema.nullable(), notices: z.array(noticeSchema).max(100) }).strict();
const pointerSchema = z.object({ snapshot: snapshotSchema, directory: z.string().regex(/^[a-f0-9]{40,64}-[a-f0-9-]{36}$/) }).strict().refine(value => value.directory.startsWith(value.snapshot.commit + '-'));
type Config = z.infer<typeof configSchema>;
interface Options { directory: string; python: string; script: string; intervalMs?: number }

export class RepositoryService {
  private config: Config | null = null;
  private workspaceFolder?: string;
  private view: RepositoryStatus = { repository: null, phase: 'idle', processed: 0, total: 0, error: null, notices: [] };
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private timer?: NodeJS.Timeout;
  private writes: Promise<void> = Promise.resolve();
  private closed = false;
  private connecting = false;
  private workspaceOperation: Promise<void> | null = null;
  private workspaceController: AbortController | null = null;
  private lastFailure = '';
  constructor(private readonly options: Options, private readonly changed: () => void) {}
  get status(): RepositoryStatus {
    const repository = this.config ? repositoryViewSchema.parse(this.configView()) : null;
    return { ...this.view, workspaceFolder: this.workspaceFolder, repository };
  }
  private configView() {
    if (!this.config) return null;
    const { source: _source, activeDirectory: _directory, pendingCommit: _pending, ...view } = this.config;
    return view;
  }
  private update(values: Partial<RepositoryStatus>) { Object.assign(this.view, values); this.changed(); }
  private notice(kind: 'info' | 'success' | 'error', title: string, body: string) {
    this.view.notices = [{ id: randomUUID(), time: new Date().toISOString(), kind, title, body: body.slice(0, 500), read: false }, ...this.view.notices].slice(0, 100);
  }
  private save(): Promise<void> {
    const content = JSON.stringify({ version: 1, workspaceFolder: this.workspaceFolder, config: this.config, notices: this.view.notices });
    const operation = this.writes.then(async () => {
      await mkdir(this.options.directory, { recursive: true });
      const file = join(this.options.directory, 'repository-state.json');
      const temporary = file + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, content, { mode: 0o600 });
      await rename(temporary, file);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async initialize() {
    try {
      const text = await readFile(join(this.options.directory, 'repository-state.json'), 'utf8');
      if (text.length > 256 * 1024) throw new Error('State limit');
      const saved = savedSchema.parse(JSON.parse(text));
      this.workspaceFolder = saved.workspaceFolder; this.config = saved.config; this.view.notices = saved.notices;
      if (this.config?.kind === 'remote') remoteSchema.parse(this.config.source);
      if (this.config) branchSchema.parse(this.config.branch);
      if (this.config) {
        try {
          const root = join(this.options.directory, 'repositories', this.config.id);
          const pointer = pointerSchema.parse(JSON.parse(await readFile(join(root, 'active.json'), 'utf8')));
          await access(join(root, 'snapshots', pointer.directory, 'index.sqlite3'));
          this.config.active = pointer.snapshot; this.config.activeDirectory = pointer.directory;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || this.config.active) throw error;
        }
      }
      this.view.phase = this.config?.active ? 'ready' : 'idle';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.config = null; this.view.phase = 'error'; this.view.error = 'Saved repository settings could not be loaded. Reconnect the repository; existing snapshots are retained.'; }
    }
    this.timer = setInterval(() => { if (this.config?.autoSync) this.sync(); }, this.options.intervalMs ?? 60000);
    this.changed();
    if (this.config?.autoSync) this.sync();
  }
  async connect(kind: 'local' | 'remote', source: string, branch: string): Promise<void> {
    if (this.running || this.connecting || this.closed) throw new RepoError('Wait for the current operation or cancel it before connecting another repository.');
    this.connecting = true;
    try {
    branchSchema.parse(branch);
    if (kind === 'remote') source = remoteSchema.parse(source);
    else source = await realpath(source);
    // Reserve the connection synchronously before any further asynchronous work.
    const name = (kind === 'local' ? basename(source) : source.split(/[/:]/).filter(Boolean).at(-1)?.replace(/\.git$/, '') || 'Repository').slice(0, 200);
    const workspacePath = this.workspaceFolder ? await createProject(this.workspaceFolder, name) : undefined;
    const previous = this.config;
    this.config = { id: randomUUID(), name, branch, kind, source, workspacePath, active: null, activeDirectory: null, pendingCommit: null, autoSync: true, lastChecked: null };
    try { await this.save(); } catch (error) { this.config = previous; throw error; }
    this.connecting = false; this.sync();
    } finally { this.connecting = false; }
  }
  sync(): boolean {
    if (this.running || !this.config || this.closed || this.connecting) return false;
    this.controller = new AbortController();
    const config = this.config;
    this.running = this.perform(config, this.controller.signal).catch(async error => {
      const cancelled = this.controller?.signal.aborted;
      const message = error instanceof RepoError ? error.message : 'Repository sync failed. Check local storage and retry; the published snapshot is preserved.';
      if (cancelled && !this.closed) config.autoSync = false;
      if (!cancelled && message !== this.lastFailure) this.notice('error', 'Repository sync failed', `${config.name}: ${message}`);
      this.lastFailure = message;
      this.update({ phase: cancelled ? 'cancelled' : 'error', error: message });
      try { await this.save(); } catch { this.update({ error: 'Repository settings could not be saved. Check disk access before retrying.' }); }
    }).finally(() => { this.running = null; this.controller = null; this.changed(); });
    return true;
  }
  private async perform(config: Config, signal: AbortSignal) {
    this.update({ phase: 'checking', error: null, processed: 0, total: 0 });
    const root = join(this.options.directory, 'repositories', config.id);
    const mirror = config.workspacePath ? join(await ownedDirectory(config.workspacePath, '.codebase-intelligence'), 'mirror.git') : join(root, 'mirror.git');
    try { if ((await lstat(mirror)).isSymbolicLink() || await realpath(mirror) !== mirror) throw new RepoError('The private Git mirror must not be a link.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await mkdir(root, { recursive: true });
    if (!config.branch) {
      if (config.kind === 'local') {
        const actual = await git(['-C', config.source, 'rev-parse', '--show-toplevel'], signal);
        if (await realpath(actual) !== await realpath(config.source)) throw new RepoError('Choose the repository root folder.');
        config.branch = await git(['-C', config.source, 'symbolic-ref', '--short', 'HEAD'], signal);
      } else {
        const refs = await git(['ls-remote', '--symref', '--', config.source, 'HEAD'], signal);
        const branch = /^ref: refs\/heads\/(.+)\s+HEAD$/m.exec(refs)?.[1];
        if (!branch) throw new RepoError('The remote has no default branch. Enter a branch containing a commit.');
        config.branch = branch;
      }
    }
    branchSchema.parse(config.branch);
    await git(['check-ref-format', '--branch', config.branch], signal);
    await this.save();
    let exists = false;
    try { await access(join(mirror, 'HEAD')); exists = true; } catch { /* first clone */ }
    if (!exists) {
      this.update({ phase: 'cloning' });
      for (let attempt = 0; ; attempt++) {
        const staging = join(dirname(mirror), 'clone-' + randomUUID());
        try {
          await git(['clone', '--bare', '--no-local', '--single-branch', '--branch', config.branch, '--', config.source, staging], signal);
          signal.throwIfAborted();
          await rename(staging, mirror);
          break;
        } catch (error) {
          if (!(error instanceof RepoError) || !error.transient || signal.aborted || attempt >= 2) throw error;
        }
      }
    }
    this.update({ phase: 'checking' });
    await git(['-C', mirror, 'fetch', '--no-tags', '--no-recurse-submodules', '--', config.source, `+refs/heads/${config.branch}:refs/heads/ci-tracked`], signal);
    const commit = await git(['-C', mirror, 'rev-parse', '--verify', 'refs/heads/ci-tracked^{commit}'], signal);
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new RepoError('The selected branch does not contain a valid commit.');
    config.lastChecked = new Date().toISOString();
    if (config.active?.commit === commit) { if (config.workspacePath) config.sourceFolder = await exportSource(config.workspacePath, mirror, commit, signal); this.lastFailure = ''; await this.save(); this.update({ phase: 'ready' }); return; }
    if (config.active && await git(['-C', mirror, 'rev-list', '--count', `${config.active.commit}..${commit}`], signal) === '0') throw new RepoError('The tracked branch moved backwards without new commits. The published snapshot is retained. Reconnect to explicitly follow the earlier history.');
    if (config.pendingCommit !== commit) {
      this.notice('info', config.active ? 'New repository commit detected' : 'Repository connected', `${config.name} · ${config.branch} · ${commit.slice(0, 8)}. Building a committed snapshot.`);
      config.pendingCommit = commit;
    }
    await this.save();
    this.update({ phase: 'indexing' });
    const stage = join(root, 'staging', `${commit}-${config.active?.commit ?? 'initial'}`);
    const previous = config.activeDirectory ? join(root, 'snapshots', config.activeDirectory) : null;
    const snapshot = await buildSnapshot(this.options.python, this.options.script, { mirror, stage, previous, commit, base: config.active?.commit ?? null }, signal,
      (processed, total) => this.update({ processed, total }));
    signal.throwIfAborted();
    snapshotSchema.parse(snapshot);
    const directory = `${commit}-${randomUUID()}`;
    await mkdir(join(root, 'snapshots'), { recursive: true });
    if (config.workspacePath) config.sourceFolder = await exportSource(config.workspacePath, mirror, commit, signal);
    await rename(stage, join(root, 'snapshots', directory));
    const previousActive = config.active;
    // This pointer is the publication authority, independent of settings/notices.
    // A crash before rename preserves the old version; a crash afterwards recovers
    // the new version on launch, even if settings have not been saved yet.
    const pointer = join(root, 'active.json');
    const temporaryPointer = pointer + '.' + randomUUID() + '.tmp';
    await writeFile(temporaryPointer, JSON.stringify({ snapshot, directory }), { mode: 0o600 });
    await rename(temporaryPointer, pointer);
    config.active = snapshot; config.activeDirectory = directory; config.pendingCommit = null;
    this.notice('success', previousActive ? 'Repository snapshot updated' : 'Repository snapshot ready', `${config.name} · ${commit.slice(0, 8)} · ${snapshot.files} files. +${snapshot.added} added, ${snapshot.modified} modified, ${snapshot.renamed} renamed, ${snapshot.deleted} deleted. ${snapshot.reused} file records reused.`);
    try { await this.save(); }
    catch { throw new RepoError('The snapshot was published, but notification settings could not be saved. Check disk access before retrying.'); }
    this.lastFailure = '';
    this.update({ phase: 'ready', error: null });
  }
  async chooseWorkspace(folder: string) {
    if (this.workspaceOperation) throw new RepoError('Workspace selection is already in progress.');
    this.workspaceController = new AbortController();
    this.workspaceOperation = this.changeWorkspace(folder, this.workspaceController.signal);
    try { await this.workspaceOperation; } finally { this.workspaceOperation = null; this.workspaceController = null; }
  }
  private async changeWorkspace(folder: string, signal: AbortSignal) {
    if (this.running || this.connecting || this.closed) throw new RepoError('Wait for sync to finish or cancel it before choosing a workspace.');
    this.connecting = true;
    const previousFolder = this.workspaceFolder; const previous = this.config;
    try {
      const selected = await workspaceDirectory(folder);
      if (selected === previousFolder && (!this.config || this.config.workspacePath)) return;
      if (this.config) {
        const project = await createProject(selected, this.config.name);
        const oldMirror = this.config.workspacePath ? join(await ownedDirectory(this.config.workspacePath, '.codebase-intelligence'), 'mirror.git') : join(this.options.directory, 'repositories', this.config.id, 'mirror.git');
        const mirror = join(project, '.codebase-intelligence', 'mirror.git');
        try { await cp(oldMirror, mirror, { recursive: true, errorOnExist: true, force: false }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const sourceFolder = this.config.active ? await exportSource(project, mirror, this.config.active.commit, signal) : undefined;
        this.config = { ...this.config, workspacePath: project, sourceFolder };
      }
      signal.throwIfAborted();
      this.workspaceFolder = selected;
      await this.save(); this.changed();
    } catch (error) { this.workspaceFolder = previousFolder; this.config = previous; throw error; }
    finally { this.connecting = false; }
  }
  workspaceProject(repoId: string): string | undefined { return this.config?.id === repoId ? this.config.workspacePath : undefined; }
  workspaceLocation(): string | undefined { return this.config?.workspacePath ?? this.workspaceFolder; }
  async cancel() { if (this.config) this.config.autoSync = false; this.controller?.abort(); await this.running; await this.save(); this.changed(); }
  async setAuto(enabled: boolean) { if (!this.config) return; this.config.autoSync = enabled; await this.save(); this.changed(); if (enabled) this.sync(); }
  async disconnect() { await this.cancel(); this.config = null; await this.save(); this.update({ phase: 'idle', processed: 0, total: 0, error: null }); }
  async markRead() { this.view.notices = this.view.notices.map(notice => ({ ...notice, read: true })); await this.save(); this.changed(); }
  async settle() { await this.running; }
  getGraphSnapshot(): { ref: SnapshotRef; preview: boolean } | null {
    const config = this.config;
    if (config?.pendingCommit && this.view.phase === 'indexing') return { preview: true, ref: {
      repoId: config.id, repoName: config.name, commit: config.pendingCommit, analyzer: 'graph-preview',
      directory: join(this.options.directory, 'repositories', config.id, 'staging', `${config.pendingCommit}-${config.active?.commit ?? 'initial'}`),
    } };
    const ref = this.getSnapshot(); return ref ? { ref, preview: false } : null;
  }
  getSnapshot(): SnapshotRef | null {
    const config = this.config;
    if (!config?.active || !config.activeDirectory) return null;
    return { repoId: config.id, repoName: config.name, commit: config.active.commit, directory: join(this.options.directory, 'repositories', config.id, 'snapshots', config.activeDirectory), analyzer: config.active.analyzer };
  }
  async notifyDocumentation(kind: 'info' | 'success' | 'error', title: string, body: string) { this.notice(kind, title, body); await this.save(); this.changed(); }
  async close() { this.closed = true; this.workspaceController?.abort(); await this.workspaceOperation?.catch(() => {}); clearInterval(this.timer); this.controller?.abort(); await this.running; await this.writes; }
}
