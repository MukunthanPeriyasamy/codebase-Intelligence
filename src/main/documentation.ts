import { exportMarkdown } from './workspace';
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DOC_VERSION, defaultDocSettings, docSettingsSchema, pageSchema, planSchema, snapshotRefSchema, catalogEntrySchema, catalogSchema, digestSchema, type DocSettings, type DocStatus, type SnapshotRef, type DocUnit, type Evidence, type DocPage } from '../shared/documentation';
import { EvidenceReader, digest, validateClaims, containsSecret } from './evidence';
import { ProviderError, OllamaProvider, type DocumentationProvider } from './ollama';
import { RepoError } from './git';

const ledgerSchema = z.object({ version: z.literal(1), settings: docSettingsSchema, day: z.string(), requests: z.number().int().nonnegative(), cost: z.number().nonnegative(), unknown: z.number().int().nonnegative() }).strict();
const jobSchema = z.object({ key: digestSchema, ref: snapshotRefSchema, plan: planSchema, done: z.record(digestSchema, catalogEntrySchema), skipped: z.record(digestSchema, z.string().max(500)), inFlight: digestSchema.nullable() }).strict();
type Job = z.infer<typeof jobSchema>;
const manifestSchema = z.object({ key: digestSchema, ref: snapshotRefSchema, entries: catalogSchema, total: z.number().int().nonnegative(), remaining: z.number().int().nonnegative(), omitted: z.number().int().nonnegative(), gaps: z.array(z.string().max(500)).max(20) }).strict();
type Manifest = z.infer<typeof manifestSchema>;
interface Options {
  knowledgeDirectory: string; reader: EvidenceReader; snapshot: () => SnapshotRef | null;
  changed: () => void;
  notify: (kind: 'success' | 'error', title: string, body: string) => Promise<void>;
  workspaceProject?: (repoId: string) => string | undefined;
  provider?: DocumentationProvider;
}
async function readJson(file: string, limit = 12 * 1024 * 1024): Promise<unknown> {
  if ((await stat(file)).size > limit) throw new RepoError('Documentation storage exceeds its size limit.');
  return JSON.parse(await readFile(file, 'utf8'));
}
async function atomic(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, file);
}
function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
const day = () => new Date().toISOString().slice(0, 10);

export class DocumentationService {
  private ledger: z.infer<typeof ledgerSchema> = { version: 1, settings: defaultDocSettings, day: day(), requests: 0, cost: 0, unknown: 0 };
  private state: DocStatus = { settings: defaultDocSettings, phase: 'idle', commit: null, sourceCommit: null, completed: 0, total: 0, remaining: 0, omitted: 0, requestsToday: 0, error: null, reportedCost: 0, unknownCostRequests: 0, gaps: [] };
  private published: Manifest | null = null;
  private running: Promise<void> | null = null;
  private refresh: Promise<void> = Promise.resolve();
  private controller: AbortController | null = null;
  private context = '';
  private closed = false;
  private broken = false;
  private configuring = false;
  private interactive = false;
  private readonly root: string;
  private readonly provider: DocumentationProvider;
  constructor(private readonly options: Options) { this.root = join(options.knowledgeDirectory, 'documentation'); this.provider = options.provider ?? new OllamaProvider(); }
  get status(): DocStatus { return { ...this.state, settings: this.ledger.settings, sourceCommit: this.options.snapshot()?.commit ?? null, requestsToday: this.ledger.day === day() ? this.ledger.requests : 0, reportedCost: this.ledger.day === day() ? this.ledger.cost : 0, unknownCostRequests: this.ledger.day === day() ? this.ledger.unknown : 0 }; }
  private update(values: Partial<DocStatus>) { Object.assign(this.state, values); this.options.changed(); }
  private validateRef(ref: SnapshotRef) {
    snapshotRefSchema.parse(ref);
    if (resolve(dirname(ref.directory)) !== resolve(this.options.knowledgeDirectory, 'repositories', ref.repoId, 'snapshots') || !new RegExp(`^${ref.commit}-[a-f0-9-]{36}$`).test(basename(ref.directory))) throw new RepoError('Documentation snapshot scope is invalid.');
  }
  private jobPath(repoId: string, key: string) { return join(this.root, repoId, 'jobs', key, 'job.json'); }
  private pagePath(repoId: string, key: string, id: string) { return join(this.root, repoId, 'jobs', key, 'pages', id + '.json'); }
  private jobKey(ref: SnapshotRef) { return digest(JSON.stringify([this.ledger.settings.provider === 'openrouter' ? 'openrouter-v2' : 'ollama-v1', DOC_VERSION, ref.repoId, ref.commit, ref.analyzer, this.ledger.settings.model, this.ledger.settings.maxOutputTokens])); }
  private async saveLedger() { await atomic(join(this.root, 'settings.json'), this.ledger); }
  async initialize() {
    try {
      this.ledger = ledgerSchema.parse(await readJson(join(this.root, 'settings.json'), 16384));
      if (!this.ledger.settings.provider) {
        // Preserve legacy accounting and published artifacts, but never send an old remote model to Ollama automatically.
        await atomic(join(this.root, 'settings.before-ollama.json'), this.ledger);
        this.ledger.settings = { ...defaultDocSettings, requestsPerDay: this.ledger.settings.requestsPerDay };
        await this.saveLedger();
      }
    }
    catch (error) { if (!missing(error)) { this.broken = true; this.update({ phase: 'error', error: 'Documentation settings or budget ledger is invalid. Restore it before generation; limits were not reset.' }); } }
    await this.refreshContext();
  }
  async configure(input: DocSettings) {
    if (this.running || this.broken || this.configuring || this.interactive) throw new RepoError('Stop generation or chat before changing settings, and resolve any storage error.');
    const settings = docSettingsSchema.parse({ ...input, provider: input.provider ?? 'ollama' });
    const previousProvider = this.ledger.settings.provider ?? 'ollama';
    settings.profiles = { ...this.ledger.settings.profiles, ...settings.profiles, [previousProvider]: { model: this.ledger.settings.model, embeddingModel: this.ledger.settings.embeddingModel ?? '' }, [settings.provider!]: { model: settings.model, embeddingModel: settings.embeddingModel ?? '' } };
    if (settings.provider !== previousProvider) settings.autoGenerate = false;
    this.configuring = true;
    const previous = this.ledger.settings; this.ledger.settings = settings;
    try { await this.saveLedger(); } catch (error) { this.ledger.settings = previous; throw error; }
    finally { this.configuring = false; }
    this.update({ error: null });
  }
  refreshContext(): Promise<void> {
    const ref = this.options.snapshot(); const token = ref ? `${ref.repoId}:${ref.commit}` : '';
    if (token === this.context) return this.refresh;
    this.context = token; this.controller?.abort();
    this.refresh = this.refresh.catch(() => {}).then(async () => {
      await this.running;
      if (token !== this.context || this.closed) return;
      this.published = null;
      this.update({ phase: 'idle', commit: null, completed: 0, total: 0, remaining: 0, omitted: 0, gaps: [], error: this.broken ? this.state.error : null });
      if (!ref) return;
      try {
        const manifest = manifestSchema.parse(await readJson(join(this.root, ref.repoId, 'published.json')));
        this.validateRef(manifest.ref);
        if (manifest.ref.repoId !== ref.repoId) throw new Error('scope');
        this.published = manifest;
        this.update({ phase: manifest.remaining || manifest.omitted ? 'partial' : 'ready', commit: manifest.ref.commit, completed: manifest.entries.length, total: manifest.total, remaining: manifest.remaining, omitted: manifest.omitted, gaps: manifest.gaps });
      } catch (error) { if (!missing(error)) this.update({ phase: 'error', error: 'Published documentation could not be loaded. Generate again to recover.' }); }
      try {
        const key = this.jobKey(ref);
        const job = jobSchema.parse(await readJson(this.jobPath(ref.repoId, key)));
        if (job.key !== key || job.ref.repoId !== ref.repoId || job.ref.commit !== ref.commit) throw new Error('scope');
        const remaining = job.plan.units.length - Object.keys(job.done).length - Object.keys(job.skipped).length;
        if (remaining > 0) this.update({ phase: 'partial', total: job.plan.units.length, completed: Object.keys(job.done).length, remaining, error: job.inFlight ? 'An earlier local request was interrupted. Resume explicitly to retry.' : null });
      } catch (error) { if (!missing(error)) this.update({ phase: 'error', error: 'Saved documentation progress could not be loaded.' }); }
      if (!this.broken && this.ledger.settings.autoGenerate && this.ledger.settings.model && this.published?.ref.commit !== ref.commit) this.start(true);
    });
    return this.refresh;
  }
  start(automatic = false): boolean {
    const ref = this.options.snapshot();
    if (this.closed || this.running || this.broken || this.configuring || this.interactive) return false;
    if (!ref) throw new RepoError('Connect and sync a repository before generating documentation.');
    if (!this.ledger.settings.model) throw new RepoError('Choose and save a model first.');
    this.validateRef(ref);
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.running = this.generate(ref, signal, automatic).catch(async error => {
      const message = error instanceof RepoError ? error.message : 'Documentation generation failed. Saved progress is retained; check settings and resume.';
      this.update({ phase: signal.aborted ? 'cancelled' : 'error', error: signal.aborted ? 'Generation stopped. Resume explicitly; remote requests may have been billed.' : message });
      if (!signal.aborted) await this.options.notify('error', 'Documentation generation stopped', message).catch(() => {});
    }).finally(() => { this.running = null; this.controller = null; this.options.changed(); });
    return true;
  }
  private async evidence(ref: SnapshotRef, unit: DocUnit, job: Job, signal: AbortSignal): Promise<Evidence[]> {
    const targets = unit.kind === 'module' ? [unit] : job.plan.units.filter(item => item.kind === 'module').sort((a, b) => Number(/(^|\/)(main|index|app|server|cli|package|pyproject|README)\./i.test(b.path)) - Number(/(^|\/)(main|index|app|server|cli|package|pyproject|README)\./i.test(a.path))).filter((item, index, all) => all.findIndex(other => other.path === item.path) === index).slice(0, 6).map(item => ({ ...item, end: Math.min(item.start + 19, item.end) }));
    const evidence: Evidence[] = [];
    for (const target of targets) {
      const item = await this.options.reader.read(ref, target, signal);
      if (item.blocked.length >= item.end - item.start + 1 || !item.text.trim()) continue;
      item.symbols = item.symbols.filter(symbol => symbol.id.length < 600 && symbol.name.length < 200).slice(0, 30);
      while (Buffer.byteLength(JSON.stringify({ kind: unit.kind, evidence: [...evidence, item] })) > 16000 && item.symbols.length) item.symbols.pop();
      if (Buffer.byteLength(JSON.stringify({ kind: unit.kind, evidence: [...evidence, item] })) <= 16000) evidence.push(item);
    }
    if (containsSecret(JSON.stringify(evidence))) throw new RepoError('Sensitive evidence was detected after filtering. This request was not sent.');
    return evidence;
  }
  private async generate(ref: SnapshotRef, signal: AbortSignal, automatic: boolean) {
    const settings = { ...this.ledger.settings };
    const key = this.jobKey(ref);
    const path = this.jobPath(ref.repoId, key);
    let job: Job;
    try {
      job = jobSchema.parse(await readJson(path));
      if (job.key !== key || job.ref.repoId !== ref.repoId || job.ref.commit !== ref.commit) throw new Error('job scope');
      // Automatic mode never retries an existing run after a restart/failure.
      if (automatic) return;
    } catch (error) {
      if (!missing(error)) throw error;
      this.update({ phase: 'planning', error: null });
      job = { key, ref, plan: await this.options.reader.plan(ref, signal), done: {}, skipped: {}, inFlight: null };
      await atomic(path, job);
    }
    let requests = 0;
    this.update({ phase: 'generating', error: null, total: job.plan.units.length, completed: Object.keys(job.done).length, remaining: job.plan.units.length - Object.keys(job.done).length - Object.keys(job.skipped).length });
    for (const unit of job.plan.units) {
      signal.throwIfAborted();
      if (job.done[unit.id] || job.skipped[unit.id]) continue;
      const evidence = await this.evidence(ref, unit, job, signal);
      if (!evidence.length) { job.skipped[unit.id] = `${unit.path}: no safe bounded source available`.slice(0, 500); await atomic(path, job); continue; }
      const inputHash = digest(JSON.stringify(evidence));
      let page: DocPage | null = null;
      try {
        const candidate = pageSchema.parse(await readJson(this.pagePath(ref.repoId, key, unit.id), 256 * 1024));
        if (candidate.id === unit.id && candidate.analyzer === ref.analyzer && candidate.commit === ref.commit && candidate.repoId === ref.repoId && candidate.model === settings.model && candidate.inputHash === inputHash) { validateClaims(candidate.content, evidence); page = candidate; }
      } catch (error) { if (!missing(error)) throw new RepoError('A saved documentation page is invalid; generation stopped rather than silently reusing it.'); }
      if (!page) {
        if (requests >= settings.requestsPerRun || (this.ledger.day === day() && this.ledger.requests >= settings.requestsPerDay)) break;
        if (this.ledger.day !== day()) { this.ledger.day = day(); this.ledger.requests = 0; this.ledger.cost = 0; this.ledger.unknown = 0; }
        this.ledger.requests++; this.ledger.unknown++; requests++;
        await this.saveLedger(); job.inFlight = unit.id; await atomic(path, job);
        signal.throwIfAborted();
        const response = await this.provider.generate(settings, unit.kind, evidence, signal).catch(async error => {
          if (error instanceof ProviderError && error.cost !== null) {
            this.ledger.cost += error.cost; this.ledger.unknown--; await this.saveLedger();
          }
          throw error;
        });
        if (response.cost !== null) { this.ledger.cost += response.cost; this.ledger.unknown--; await this.saveLedger(); }
        validateClaims(response.content, evidence);
        const represented = new Set(response.content.sections.map(section => section.symbolId));
        const missingSymbols = evidence.flatMap(item => item.symbols).filter(symbol => !represented.has(symbol.id)).length;
        const gaps = [...response.content.gaps];
        if (missingSymbols) gaps.push(`${missingSymbols} supplied symbols have no individual function section.`);
        if (evidence.some(item => item.blocked.length)) gaps.push('Some source lines were redacted or omitted.');
        if (unit.kind === 'workflow') gaps.push('Workflow interpretation uses bounded representative excerpts, not a complete resolved execution graph.');
        page = pageSchema.parse({ provider: settings.provider ?? 'ollama', id: unit.id, repoId: ref.repoId, commit: ref.commit, model: settings.model, servedModel: response.servedModel, promptVersion: DOC_VERSION, analyzer: ref.analyzer, kind: unit.kind, evidence, content: { ...response.content, gaps: gaps.slice(-20) }, inputHash, created: new Date().toISOString(), cost: response.cost });
        await atomic(this.pagePath(ref.repoId, key, unit.id), page);
      }
      job.done[unit.id] = { id: unit.id, title: page.content.title, kind: unit.kind, path: unit.kind === 'module' ? `${unit.path}:${unit.start}–${unit.end}` : unit.path };
      job.inFlight = null; await atomic(path, job);
      this.update({ completed: Object.keys(job.done).length, remaining: job.plan.units.length - Object.keys(job.done).length - Object.keys(job.skipped).length });
    }
    signal.throwIfAborted();
    const current = this.options.snapshot();
    if (!current || current.repoId !== ref.repoId || current.commit !== ref.commit) throw new RepoError('The repository changed during generation. Resume against its new published commit.');
    const entries = Object.values(job.done);
    for (const entry of entries) {
      const saved = pageSchema.parse(await readJson(this.pagePath(ref.repoId, key, entry.id), 256 * 1024));
      if (saved.id !== entry.id || saved.repoId !== ref.repoId || saved.commit !== ref.commit || saved.model !== settings.model || saved.inputHash !== digest(JSON.stringify(saved.evidence))) throw new RepoError('Saved documentation failed validation. Publication was stopped.');
      validateClaims(saved.content, saved.evidence);
    }
    const remaining = job.plan.units.length - entries.length - Object.keys(job.skipped).length;
    const omitted = job.plan.omitted + job.plan.excluded + Object.keys(job.skipped).length;
    if (!entries.length && remaining) {
      this.update({ phase: 'partial', remaining, omitted, error: 'The request budget is exhausted. Previous documentation is retained; increase the limit or resume after the UTC daily reset.' });
      return;
    }
    const gaps = Object.values(job.skipped).slice(0, 18);
    if (job.plan.omitted) gaps.push(`${job.plan.omitted} items exceeded the 2,000-page planning limit.`);
    if (job.plan.excluded) gaps.push(`${job.plan.excluded} inventory files have no captured text.`);
    if (remaining) gaps.push(`${remaining} pages remain. Resume grants another bounded run; daily limits still apply.`);
    const manifest = manifestSchema.parse({ key, ref, entries, total: job.plan.units.length, remaining, omitted, gaps: gaps.slice(0, 20) });
    signal.throwIfAborted();
    await atomic(join(this.root, ref.repoId, 'published.json'), manifest);
    this.published = manifest;
    this.update({ phase: remaining || omitted ? 'partial' : 'ready', commit: ref.commit, completed: entries.length, total: job.plan.units.length, remaining, omitted, gaps: manifest.gaps });
    await this.exportCurrent();
    await this.options.notify('success', remaining || omitted ? 'Documentation available with gaps' : 'Documentation ready', `${ref.repoName} · ${ref.commit.slice(0, 8)} · ${entries.length} pages; ${remaining} remaining and ${omitted} excluded/omitted items.`).catch(() => {});
  }
  async exportCurrent() {
    const manifest = this.published;
    if (!manifest || manifest.ref.repoId !== this.options.snapshot()?.repoId) return;
    const project = this.options.workspaceProject?.(manifest.ref.repoId);
    if (!project) return;
    const pages: DocPage[] = [];
    for (const entry of manifest.entries) pages.push(await this.page(entry.id));
    if (this.published !== manifest) throw new RepoError('Documentation changed during export. Retry the export.');
    await exportMarkdown(project, manifest.ref.commit, pages, manifest.remaining, manifest.omitted);
  }
  catalog() { if (this.published?.ref.repoId !== this.options.snapshot()?.repoId) return []; return this.published?.entries ?? []; }
  fingerprint(ref: SnapshotRef): string {
    const manifest = this.published;
    return digest(JSON.stringify(manifest?.ref.repoId === ref.repoId && manifest.ref.commit === ref.commit ? [manifest.key, manifest.entries] : null));
  }
  async retrieveEvidence(ref: SnapshotRef, question: string): Promise<Evidence[]> {
    const manifest = this.published;
    if (!manifest || manifest.ref.repoId !== ref.repoId || manifest.ref.commit !== ref.commit) return [];
    const terms = question.toLowerCase().match(/[\w./-]{3,}/g) ?? [];
    const ranked = manifest.entries.map(entry => ({ entry, score: terms.reduce((sum, term) => sum + Number(`${entry.title} ${entry.path}`.toLowerCase().includes(term)), 0) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    const evidence: Evidence[] = [];
    for (const { entry } of ranked) {
      const page = await this.page(entry.id);
      if (this.published !== manifest || page.commit !== ref.commit) return [];
      evidence.push(...page.evidence);
    }
    return evidence.slice(0, 6);
  }
  async acquireInteractive(): Promise<() => void> {
    if (this.interactive || this.configuring || this.closed) throw new RepoError('Another interactive request or settings change is active.');
    this.interactive = true;
    await this.cancel();
    return () => { this.interactive = false; };
  }
  async requestInteractive<T extends { cost: number | null }>(run: (settings: DocSettings) => Promise<T>, signal: AbortSignal): Promise<T> {
    if (!this.interactive || this.broken || !this.ledger.settings.model) throw new RepoError('Save a model and resolve any budget storage error before asking for an explanation.');
    if (this.ledger.day === day() && this.ledger.requests >= this.ledger.settings.requestsPerDay) throw new RepoError('The shared daily request budget is exhausted.');
    signal.throwIfAborted();
    if (this.ledger.day !== day()) { this.ledger.day = day(); this.ledger.requests = 0; this.ledger.cost = 0; this.ledger.unknown = 0; }
    this.ledger.requests++; this.ledger.unknown++; await this.saveLedger(); this.options.changed();
    const result = await run({ ...this.ledger.settings }).catch(async error => {
      if (error instanceof ProviderError && error.cost !== null) { this.ledger.cost += error.cost; this.ledger.unknown--; await this.saveLedger(); }
      throw error;
    });
    if (result.cost !== null) { this.ledger.cost += result.cost; this.ledger.unknown--; await this.saveLedger(); }
    this.options.changed(); return result;
  }
  async page(id: string): Promise<DocPage> {
    digestSchema.parse(id);
    const manifest = this.published;
    if (!manifest || manifest.ref.repoId !== this.options.snapshot()?.repoId || !manifest.entries.some(entry => entry.id === id)) throw new RepoError('This page is no longer in the selected documentation. Refresh the page list.');
    const page = pageSchema.parse(await readJson(this.pagePath(manifest.ref.repoId, manifest.key, id), 256 * 1024));
    if (page.id !== id || page.repoId !== manifest.ref.repoId || page.commit !== manifest.ref.commit || page.inputHash !== digest(JSON.stringify(page.evidence))) throw new RepoError('Documentation evidence is invalid.');
    validateClaims(page.content, page.evidence);
    return page;
  }
  async citation(id: string, section: number, claim: number, citation: number): Promise<Evidence> {
    const manifest = this.published;
    const page = await this.page(id);
    if (!manifest || this.published !== manifest) throw new RepoError('Documentation changed. Reopen the citation.');
    const selected = page.content.sections[section]?.claims[claim]?.citations[citation];
    const evidence = page.evidence.find(item => item.id === selected?.evidenceId);
    if (!selected || !evidence) throw new RepoError('Citation does not exist.');
    this.validateRef(manifest.ref);
    const current = await this.options.reader.read(manifest.ref, { id: evidence.id, kind: 'module', path: evidence.path, hash: evidence.hash, start: selected.start, end: selected.end });
    if (current.blocked.length || !current.text.includes(selected.quote)) throw new RepoError('Citation source no longer matches its recorded evidence.');
    return current;
  }
  async cancel() { this.controller?.abort(); await this.running; }
  async settle() { await this.refresh; await this.running; }
  async close() { this.closed = true; await this.cancel(); await this.refresh; }
}
