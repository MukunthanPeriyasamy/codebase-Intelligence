import { z } from 'zod';
import { graphSchema } from './graph';
import { modelCatalogSchema } from './models';
import { chatStatusSchema, questionSchema } from './chat';
import { docSettingsSchema, docStatusSchema, catalogSchema, pageSchema, evidenceSchema, digestSchema, type DocSettings } from './documentation';
import { branchSchema, remoteSchema, repositoryStatusSchema } from './repository';

export const PROTOCOL_VERSION = 1;
export const failureSchema = z.object({
  code: z.enum(['WORKER_START', 'WORKER_EXIT', 'WORKER_TIMEOUT', 'WORKER_PROTOCOL', 'RUNTIME_VERSION', 'STORAGE_INIT', 'REQUEST_INVALID', 'BUSY', 'INTERNAL']),
  message: z.string().max(300),
}).strict();
export type Failure = z.infer<typeof failureSchema>;
export const workerStatusSchema = z.object({
  state: z.enum(['stopped', 'starting', 'ready', 'stopping', 'error']),
  python: z.string().max(30).nullable(),
  storageReady: z.boolean(),
  error: failureSchema.nullable(),
}).strict();
export type WorkerStatus = z.infer<typeof workerStatusSchema>;
export const desktopStatusSchema = z.object({ worker: workerStatusSchema, credential: z.object({ available: z.boolean(), configured: z.boolean(), error: z.string().max(300).nullable() }).strict(), ollama: z.object({ connected: z.boolean(), error: z.string().max(300).nullable() }).strict(), sync: repositoryStatusSchema, docs: docStatusSchema, chat: chatStatusSchema }).strict();
export type DesktopStatus = z.infer<typeof desktopStatusSchema>;
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.ask'), question: questionSchema }).strict(),
  z.object({ type: z.literal('chat.cancel') }).strict(),
  z.object({ type: z.literal('chat.clear') }).strict(),
  z.object({ type: z.literal('chat.citation'), id: z.string().uuid(), section: z.number().int().min(0).max(11), claim: z.number().int().min(0).max(7), citation: z.number().int().min(0).max(3) }).strict(),
  z.object({ type: z.literal('docs.configure'), settings: docSettingsSchema }).strict(),
  z.object({ type: z.literal('docs.generate') }).strict(),
  z.object({ type: z.literal('docs.cancel') }).strict(),
  z.object({ type: z.literal('docs.catalog') }).strict(),
  z.object({ type: z.literal('docs.page'), id: digestSchema }).strict(),
  z.object({ type: z.literal('docs.citation'), id: digestSchema, section: z.number().int().min(0).max(11), claim: z.number().int().min(0).max(7), citation: z.number().int().min(0).max(3) }).strict(),
  z.object({ type: z.literal('workspace.choose') }).strict(),
  z.object({ type: z.literal('workspace.open') }).strict(),
  z.object({ type: z.literal('docs.export') }).strict(),
  z.object({ type: z.literal('repository.graph') }).strict(),
  z.object({ type: z.literal('models.list'), kind: z.enum(['chat', 'embedding']), provider: z.enum(['ollama', 'openrouter']).optional() }).strict(),
  z.object({ type: z.literal('credential.save'), key: z.string().trim().min(8).max(512).regex(/^[\x21-\x7E]+$/) }).strict(),
  z.object({ type: z.literal('credential.clear') }).strict(),
  z.object({ type: z.literal('ollama.test') }).strict(),
  z.object({ type: z.literal('status') }).strict(),
  z.object({ type: z.literal('worker.restart') }).strict(),
  z.object({ type: z.literal('worker.stop') }).strict(),
  z.object({ type: z.literal('repository.local'), branch: branchSchema }).strict(),
  z.object({ type: z.literal('repository.clone'), url: remoteSchema, branch: branchSchema }).strict(),
  z.object({ type: z.literal('repository.sync') }).strict(),
  z.object({ type: z.literal('repository.cancel') }).strict(),
  z.object({ type: z.literal('repository.auto'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('repository.disconnect') }).strict(),
  z.object({ type: z.literal('notices.read') }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: desktopStatusSchema, graph: graphSchema.nullable().optional(), models: modelCatalogSchema.optional(), catalog: catalogSchema.optional(), document: pageSchema.optional(), source: evidenceSchema.optional() }).strict(),
  z.object({ ok: z.literal(false), error: failureSchema }).strict(),
]);
export type Result = z.infer<typeof resultSchema>;
export const workerEventSchema = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('ready'), python: z.string().regex(/^3\.(12|14)\.\d+$/), schema: z.literal(1) }).strict(),
  z.object({ v: z.literal(1), type: z.literal('pong'), id: z.string().uuid() }).strict(),
  z.object({ v: z.literal(1), type: z.literal('error'), code: z.enum(['RUNTIME_VERSION', 'STORAGE_INIT', 'REQUEST_INVALID']) }).strict(),
]);
export interface DesktopBridge {
  saveCredential(key: string): Promise<Result>;
  clearCredential(): Promise<Result>;
  testOllama(): Promise<Result>;
  chooseWorkspace(): Promise<Result>;
  openWorkspace(): Promise<Result>;
  exportDocs(): Promise<Result>;
  repositoryGraph(): Promise<Result>;
  listModels(kind: 'chat' | 'embedding', provider?: 'ollama' | 'openrouter'): Promise<Result>;
  askQuestion(question: string): Promise<Result>;
  cancelQuestion(): Promise<Result>;
  clearChat(): Promise<Result>;
  chatCitation(id: string, section: number, claim: number, citation: number): Promise<Result>;
  configureDocs(settings: DocSettings): Promise<Result>;
  generateDocs(): Promise<Result>;
  cancelDocs(): Promise<Result>;
  docCatalog(): Promise<Result>;
  docPage(id: string): Promise<Result>;
  docCitation(id: string, section: number, claim: number, citation: number): Promise<Result>;
  status(): Promise<Result>;
  restartWorker(): Promise<Result>;
  stopWorker(): Promise<Result>;
  connectLocal(branch: string): Promise<Result>;
  cloneRepository(url: string, branch: string): Promise<Result>;
  syncRepository(): Promise<Result>;
  cancelSync(): Promise<Result>;
  setAutoSync(enabled: boolean): Promise<Result>;
  disconnectRepository(): Promise<Result>;
  markNoticesRead(): Promise<Result>;
  onStatus(listener: (status: DesktopStatus) => void): () => void;
}
