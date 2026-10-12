import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import { digest, containsSecret, EvidenceReader } from './evidence';
import { RepoError, childEnvironment } from './git';
import { stopOwnedProcess } from './processes';
import { inspectModel, ollamaJson } from './ollama';
import { openRouterEmbedding } from './openrouter';
import { unitSchema, type DocSettings, type DocUnit, type SnapshotRef } from '../shared/documentation';
import type { DocumentationService } from './documentation';

const vectorSchema = z.array(z.number().finite()).min(1).max(8192).refine(v => v.some(n => n !== 0));
const manifestSchema = z.object({ key: z.string(), total: z.number().int().nonnegative(), omitted: z.number().int().nonnegative() }).strict();
export type VectorStatus = { phase: 'idle' | 'indexing' | 'ready' | 'error' | 'cancelled'; completed: number; total: number; error: string | null; commit: string | null };
export type Embed = (settings: DocSettings, texts: string[], signal: AbortSignal) => Promise<number[][]>;
export function embeddingProvider(docs: DocumentationService, key: () => Promise<string>): Embed {
  return async (settings, texts, signal) => {
    if (!settings.embeddingModel) throw new RepoError('Choose and save an embedding model first.');
    let result: number[][];
    if (settings.provider === 'openrouter') {
      const response = await docs.requestInteractive(async () => openRouterEmbedding(settings.embeddingModel!, texts, await key(), signal), signal);
      result = response.vectors;
    } else {
      const info = await inspectModel(settings.embeddingModel, signal);
      if (info.capabilities && !info.capabilities.includes('embedding')) throw new RepoError('Select an Ollama embedding model, not a chat model.');
      result = z.object({ embeddings: z.array(vectorSchema) }).parse(await ollamaJson('/api/embed', { model: settings.embeddingModel, input: texts, truncate: false }, signal)).embeddings;
    }
    if (result.length !== texts.length || result.some(v => v.length !== result[0]?.length)) throw new RepoError('Embedding response count or dimensions do not match the request.');
    return result.map(v => vectorSchema.parse(v));
  };
}
export class VectorStore extends EvidenceReader {
  private child?: ChildProcessWithoutNullStreams;
  private receive?: (value?: string) => void;
  private idle?: NodeJS.Timeout;
  constructor(private engine: string, private bridge: string) { super(engine, bridge); }
  close() { clearTimeout(this.idle); const child = this.child; this.child = undefined; if (child) stopOwnedProcess(child); this.receive?.(); }
  async operation(ref: SnapshotRef, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (this.receive) throw new RepoError('Vector storage is busy.');
    clearTimeout(this.idle);
    const payload = JSON.stringify({ directory: ref.directory, commit: ref.commit, ...input }) + '\n';
    if (Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new RepoError('Embedding batch exceeds the storage message limit.');
    if (!this.child) {
      const child = spawn(this.engine, ['-I', '-u', this.bridge], { env: childEnvironment(), stdio: 'pipe', windowsHide: true, detached: process.platform !== 'win32' });
      this.child = child; let buffer = '';
      child.stdout.setEncoding('utf8'); child.stderr.resume();
      child.stdout.on('data', (chunk: string) => {
        if (this.child !== child) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { this.close(); return; }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); this.receive?.(line); }
      });
      const fail = () => { if (this.child === child) { this.child = undefined; this.receive?.(); } };
      child.on('error', fail); child.on('close', fail); child.stdin.on('error', fail);
    }
    return new Promise((resolve, reject) => {
      const abort = () => this.close(); const timer = setTimeout(abort, 60000);
      this.receive = line => {
        this.receive = undefined; clearTimeout(timer); signal.removeEventListener('abort', abort);
        this.idle = setTimeout(() => this.close(), 30000); this.idle.unref();
        try { if (!line) throw new Error('Closed'); resolve(z.object({ ok: z.literal(true), data: z.unknown() }).strict().parse(JSON.parse(line)).data); }
        catch { reject(new RepoError('LanceDB storage failed. Check disk space and rerun RepoWise setup to install vector dependencies; resume indexing to reuse saved embeddings.')); }
      };
      signal.addEventListener('abort', abort, { once: true }); this.child!.stdin.write(payload);
      if (signal.aborted) abort();
    });
  }
}
interface Options { snapshot: () => SnapshotRef | null; docs: DocumentationService; reader: EvidenceReader; store: VectorStore; embed: Embed; changed: () => void; busy?: () => boolean }
export class VectorService {
  status: VectorStatus = { phase: 'idle', completed: 0, total: 0, error: null, commit: null };
  private controller?: AbortController;
  private running?: Promise<void>;
  private enabled = new Set<string>();
  constructor(private options: Options) {}
  private profile(settings = this.options.docs.status.settings) { return digest(JSON.stringify(['code-vectors-v1', settings.provider ?? 'ollama', settings.embeddingModel])); }
  private manifest(ref: SnapshotRef, profile: string) { return join(dirname(dirname(ref.directory)), 'vectors', `${digest(ref.directory + profile)}.json`); }
  async ready(ref: SnapshotRef, settings = this.options.docs.status.settings) {
    try { return manifestSchema.parse(JSON.parse(await readFile(this.manifest(ref, this.profile(settings)), 'utf8'))).key === this.profile(settings); } catch { return false; }
  }
  async identity(ref: SnapshotRef) { return `${this.profile()}:${await this.ready(ref)}`; }
  start() {
    if (this.running) throw new RepoError('Code indexing is already running.');
    const ref = this.options.snapshot(); if (!ref) throw new RepoError('Connect and sync a repository first.');
    const settings = { ...this.options.docs.status.settings };
    if (!settings.embeddingModel) throw new RepoError('Save an embedding model in Models & limits first.');
    this.enabled.add(ref.repoId + ref.commit);
    this.controller = new AbortController();
    this.status = { phase: 'indexing', completed: 0, total: 0, error: null, commit: ref.commit }; this.options.changed();
    this.running = this.build(ref, settings, this.controller.signal).catch(error => {
      this.status.phase = this.controller?.signal.aborted ? 'cancelled' : 'error';
      this.status.error = error instanceof RepoError ? error.message : 'Code indexing failed. Check RepoWise setup, embedding model and disk space; resume to reuse saved vectors.';
    }).finally(() => { this.running = undefined; this.options.changed(); if (this.options.snapshot()?.commit !== ref.commit) void this.contextChanged(); });
  }
  private async build(ref: SnapshotRef, settings: DocSettings, signal: AbortSignal) {
    const release = await this.options.docs.acquireInteractive();
    try {
      const profile = this.profile(settings); const plan = await this.options.reader.plan(ref, signal);
      const units = plan.units.filter(unit => unit.kind !== 'workflow');
      this.status.total = units.length; let omitted = plan.omitted + plan.excluded;
      for (const unit of units) {
        signal.throwIfAborted();
        const evidence = await this.options.reader.read(ref, unit, signal);
        const lines = evidence.text.split('\n');
        const rows: Array<DocUnit & { key: string; text: string }> = [];
        for (let offset = 0; offset < lines.length; offset += 40) {
          const text = lines.slice(offset, offset + 40).join('\n');
          const start = unit.start + offset; const end = start + lines.slice(offset, offset + 40).length - 1;
          if (!text.trim() || evidence.blocked.some(n => n >= start && n <= end) || containsSecret(unit.path + '\n' + text)) { omitted++; continue; }
          const input = unit.path + '\n' + text;
          rows.push({ ...unit, start, end, id: digest(`${unit.path}:${unit.hash}:${start}:${end}`), key: digest(input), text: input });
        }
        if (rows.length) {
          const cached = z.record(z.string(), vectorSchema).parse(await this.options.store.operation(ref, { operation: 'lookup', profile, keys: rows.map(row => row.key) }, signal));
          const missing = rows.filter(row => !cached[row.key]);
          if (missing.length) {
            const vectors = await this.options.embed(settings, missing.map(row => row.text), signal);
            if (vectors.length !== missing.length) throw new RepoError('Embedding count mismatch.');
            missing.forEach((row, index) => { cached[row.key] = vectorSchema.parse(vectors[index]); });
          }
          await this.options.store.operation(ref, { operation: 'put', profile, rows: rows.map(({ text: _text, kind: _kind, ...row }) => ({ ...row, vector: cached[row.key] })) }, signal);
        }
        this.status.completed++; this.options.changed();
      }
      signal.throwIfAborted();
      const path = this.manifest(ref, profile); await mkdir(dirname(path), { recursive: true });
      const temporary = path + '.' + randomUUID(); await writeFile(temporary, JSON.stringify({ key: profile, total: units.length, omitted })); await rename(temporary, path);
      await writeFile(join(dirname(path), 'enabled.json'), JSON.stringify({ localAuto: settings.provider !== 'openrouter', profile }));
      this.status.phase = 'ready'; this.status.error = omitted ? `${omitted} files/pages or redacted chunks omitted; indexing coverage is bounded.` : null;
    } finally { release(); }
  }
  async search(ref: SnapshotRef, question: string, signal: AbortSignal): Promise<DocUnit[] | null> {
    const settings = { ...this.options.docs.status.settings };
    if (!settings.embeddingModel || !await this.ready(ref, settings)) return null;
    const vectors = await this.options.embed(settings, [question], signal);
    return z.array(unitSchema).max(6).parse(await this.options.store.operation(ref, { operation: 'search', profile: this.profile(settings), vector: vectors[0] }, signal));
  }
  async contextChanged() {
    const ref = this.options.snapshot(); if (!ref || this.running || this.options.busy?.()) return;
    if (await this.ready(ref)) { this.status = { ...this.status, phase: 'ready', commit: ref.commit, error: null }; this.options.changed(); return; }
    this.status = { phase: 'idle', completed: 0, total: 0, error: null, commit: ref.commit }; this.options.changed();
    try {
      const saved = JSON.parse(await readFile(join(dirname(dirname(ref.directory)), 'vectors', 'enabled.json'), 'utf8'));
      if (saved.localAuto && saved.profile === this.profile() && this.options.docs.status.settings.provider !== 'openrouter' && !this.enabled.has(ref.repoId + ref.commit)) {
        this.enabled.add(ref.repoId + ref.commit); this.start();
      }
    } catch { /* No opt-in on this repository yet. */ }
  }
  async cancel() { this.controller?.abort(); await this.running; this.options.store.close(); }
  async settle() { await this.running; }
}
