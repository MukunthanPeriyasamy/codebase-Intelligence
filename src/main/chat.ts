import { OLLAMA_GENERATION_TIMEOUT_MS } from './ollama';
import { answerQuality } from './answer-quality';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { z } from 'zod';
import { answerSchema, CHAT_VERSION, questionSchema, type ChatAnswer, type ChatStatus } from '../shared/chat';
import { snapshotRefSchema, type SnapshotRef, type Evidence, type Generated } from '../shared/documentation';
import { DocumentationService } from './documentation';
import { RetrievalReader } from './retrieval';
import { containsSecret, digest, validateClaims } from './evidence';
import { RepoError } from './git';
import { OllamaChatProvider, chatCompletionSchema, type ChatInput, type ChatProvider } from './chat-provider';

const savedSchema = z.object({ version: z.literal(CHAT_VERSION), ref: snapshotRefSchema, answer: answerSchema }).strict();
interface Options { directory: string; snapshot: () => SnapshotRef | null; reader: RetrievalReader; docs: DocumentationService; changed: () => void; provider?: ChatProvider }
export class ChatService {
  private state: ChatStatus = { phase: 'idle', error: null, answers: [] };
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private refs = new Map<string, SnapshotRef>();
  private closed = false;
  private activeRepo: string | null = null;
  private readonly provider: ChatProvider;
  constructor(private readonly options: Options) { this.provider = options.provider ?? new OllamaChatProvider(); }
  get status(): ChatStatus { return { ...this.state, answers: this.state.answers.filter(answer => answer.repoId === this.options.snapshot()?.repoId) }; }
  private update(values: Partial<ChatStatus>) { Object.assign(this.state, values); this.options.changed(); }
  private validateRef(ref: SnapshotRef) {
    snapshotRefSchema.parse(ref);
    if (resolve(dirname(ref.directory)) !== resolve(this.options.directory, 'repositories', ref.repoId, 'snapshots') || !new RegExp(`^${ref.commit}-[a-f0-9-]{36}$`).test(basename(ref.directory))) throw new RepoError('Chat snapshot scope is invalid.');
  }
  start(input: string) {
    if (this.closed || this.running) throw new RepoError('Wait for the current answer or stop it first.');
    const question = questionSchema.parse(input); const ref = this.options.snapshot();
    if (!ref) throw new RepoError('Connect and sync a repository before asking questions.');
    this.validateRef(ref);
    this.activeRepo = ref.repoId;
    if (containsSecret(question)) throw new RepoError('The question appears to contain a secret. Remove it before asking.');
    this.controller = new AbortController(); const signal = this.controller.signal;
    const deadline = setTimeout(() => this.controller?.abort(), 2 * OLLAMA_GENERATION_TIMEOUT_MS + 60000);
    this.update({ phase: 'retrieving', error: null });
    this.running = this.answer(ref, question, signal).catch(error => {
      this.update({ phase: signal.aborted ? 'cancelled' : 'error', error: signal.aborted ? 'Question stopped. Remote requests may have been billed.' : error instanceof RepoError ? error.message : 'The answer could not be verified. Retry with a file or symbol name.' });
    }).finally(() => { clearTimeout(deadline); this.running = null; this.controller = null; this.options.changed(); });
  }
  private async verify(ref: SnapshotRef, answer: ChatAnswer, signal?: AbortSignal) {
    if (answer.repoId !== ref.repoId || answer.commit !== ref.commit) throw new RepoError('Answer scope mismatch.');
    for (const item of answer.evidence) {
      const current = await this.options.reader.read(ref, { ...item, kind: 'module' }, signal);
      if (current.text !== item.text || JSON.stringify(current.blocked) !== JSON.stringify(item.blocked)) throw new RepoError('Answer source no longer matches its captured evidence.');
    }
    if (answer.content) validateClaims(answer.content, answer.evidence);
  }
  private async answer(ref: SnapshotRef, question: string, signal: AbortSignal) {
    const release = await this.options.docs.acquireInteractive();
    try {
      signal.throwIfAborted();
      const settings = { ...this.options.docs.status.settings };
      const previousQuestions: string[] = [];
      for (const item of this.state.answers.filter(item => item.repoId === ref.repoId && item.commit === ref.commit).slice(-3).reverse()) {
        if (Buffer.byteLength(JSON.stringify([item.question, ...previousQuestions])) <= 3500) previousQuestions.unshift(item.question);
      }
      const fingerprint = digest(JSON.stringify([CHAT_VERSION, ref, question, previousQuestions, settings.provider ?? 'ollama', settings.model, settings.maxOutputTokens, this.options.docs.fingerprint(ref)]));
      const cache = join(this.options.directory, 'chat', ref.repoId, fingerprint + '.json');
      try {
        if ((await stat(cache)).size > 256 * 1024) throw new Error('limit');
        const saved = savedSchema.parse(JSON.parse(await readFile(cache, 'utf8')));
        if (JSON.stringify(saved.ref) !== JSON.stringify(ref) || saved.answer.fingerprint !== fingerprint || saved.answer.question !== question) throw new Error('scope');
        await this.verify(ref, saved.answer, signal);
        this.publish(ref, { ...saved.answer, id: randomUUID(), cached: true }, signal); return;
      } catch (error) {
        signal.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new RepoError('Cached answer failed validation. Start a new question after restoring or removing the damaged cache.');
      }
      let retrieval = await this.options.reader.retrieve(ref, question, false, signal);
      let documents = retrieval.exact ? [] : await this.options.docs.retrieveEvidence(ref, question);
      const documentIds = new Set<string>();
      let evidence = await this.options.reader.pack(ref, retrieval, documents, signal, documentIds);
      let expanded = false;
      const expand = async () => {
        expanded = true;
        const effective = [...previousQuestions, question].join('\n');
        retrieval = await this.options.reader.retrieve(ref, effective, true, signal);
        retrieval.exact = false;
        documents = await this.options.docs.retrieveEvidence(ref, effective);
        documentIds.clear();
        evidence = await this.options.reader.pack(ref, retrieval, documents, signal, documentIds);
      };
      if (!retrieval.exact && evidence.length < 2) await expand();
      let content: Generated | null = null; let mode: ChatAnswer['mode'] = 'insufficient'; let servedModel = ''; let cost: number | null = 0;
      let gaps = [...retrieval.gaps];
      // Only a unique parser-backed definition location takes the free direct path.
      if (retrieval.exact && evidence.length === 1) {
        const item = evidence[0]!; const offset = item.text.split('\n').findIndex((line, index) => line.trim() && !item.blocked.includes(item.start + index));
        if (offset >= 0) {
          content = { title: 'Symbol location', sections: [{ title: 'Captured definition', kind: 'module', symbolId: null, claims: [{ text: `The matching definition is in ${item.path.slice(0, 500)}, starting at line ${item.start}.`, basis: 'inferred', citations: [{ evidenceId: item.id, start: item.start + offset, end: item.start + offset, quote: item.text.split('\n')[offset]!.slice(0, 200) }] }] }], gaps: ['This is a direct structural lookup, not a behavioral explanation.'] };
          mode = 'direct';
        }
      } else if (evidence.length) {
        for (let attempt = 0; attempt < Math.min(2, settings.requestsPerRun); attempt++) {
          signal.throwIfAborted();
          const input: ChatInput = { question, previousQuestions, evidence, gaps: retrieval.gaps };
          while (Buffer.byteLength(JSON.stringify(input)) > 16000 && evidence.length) evidence.pop();
          if (!evidence.length) { gaps.push('No safe evidence fits the question and conversation budget.'); break; }
          this.update({ phase: 'answering' });
          const response = await this.options.docs.requestInteractive((savedSettings) => this.provider.answer(savedSettings, input, signal), signal);
          const result = chatCompletionSchema.parse(response.content);
          cost = cost === null || response.cost === null ? null : cost + response.cost; servedModel = response.servedModel;
          if (result.sufficient && result.content) { content = result.content; validateClaims(content, evidence); mode = 'model'; gaps = [...retrieval.gaps, ...result.gaps]; break; }
          gaps = [...retrieval.gaps, ...result.gaps, 'The available evidence is insufficient for a supported answer.'];
          if (expanded || attempt + 1 >= settings.requestsPerRun) break;
          if (this.options.docs.status.requestsToday >= settings.requestsPerDay) { gaps.push('The shared daily budget prevents another model request.'); break; }
          const before = digest(JSON.stringify(evidence)); await expand();
          if (before === digest(JSON.stringify(evidence))) break;
        }
      } else gaps.push('No safe supporting evidence was retrieved. Try an exact file or symbol name.');
      if (containsSecret(JSON.stringify({ content, gaps }))) throw new RepoError('The response may contain sensitive content and was not displayed.');
      const answer = answerSchema.parse({ provider: settings.provider ?? 'ollama', id: randomUUID(), repoId: ref.repoId, commit: ref.commit, question, mode, cached: false, model: mode === 'model' ? settings.model : '', servedModel, content, evidence, gaps: gaps.slice(0, 20), route: retrieval.route, expanded, documents: documents.length, quality: answerQuality(mode, content, evidence, gaps, retrieval, documentIds), created: new Date().toISOString(), cost, fingerprint });
      await this.verify(ref, answer, signal); signal.throwIfAborted();
      if (mode !== 'insufficient') {
        await mkdir(dirname(cache), { recursive: true }); const temporary = cache + '.' + randomUUID() + '.tmp';
        await writeFile(temporary, JSON.stringify({ version: CHAT_VERSION, ref, answer }), { mode: 0o600 }); await rename(temporary, cache);
      }
      this.publish(ref, answer, signal);
    } finally { release(); }
  }
  private publish(ref: SnapshotRef, answer: ChatAnswer, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.options.snapshot()?.repoId !== ref.repoId) throw new RepoError('The repository changed. Ask again in the selected repository.');
    this.refs.set(answer.id, ref);
    const answers = [...this.state.answers.filter(item => item.repoId === ref.repoId), answer].slice(-20);
    for (const id of this.refs.keys()) if (!answers.some(item => item.id === id)) this.refs.delete(id);
    this.update({ phase: 'ready', error: null, answers });
  }
  async citation(id: string, section: number, claim: number, citation: number): Promise<Evidence> {
    const answer = this.state.answers.find(item => item.id === id && item.repoId === this.options.snapshot()?.repoId); const ref = this.refs.get(id);
    if (!answer || !ref) throw new RepoError('This answer is no longer in the current conversation.');
    this.validateRef(ref);
    const selected = answer.content?.sections[section]?.claims[claim]?.citations[citation];
    const item = answer.evidence.find(item => item.id === selected?.evidenceId);
    if (!selected || !item) throw new RepoError('Citation does not exist.');
    const source = await this.options.reader.read(ref, { ...item, kind: 'module', start: selected.start, end: selected.end });
    if (source.blocked.length || !source.text.includes(selected.quote)) throw new RepoError('Citation source failed verification.');
    return source;
  }
  async clear() { await this.cancel(); this.refs.clear(); this.update({ phase: 'idle', error: null, answers: [] }); }
  contextChanged() { if (this.activeRepo !== this.options.snapshot()?.repoId) { this.controller?.abort(); this.refs.clear(); this.state.answers = []; } }
  async cancel() { this.controller?.abort(); await this.running; }
  async settle() { await this.running; }
  async close() { this.closed = true; await this.cancel(); }
}
