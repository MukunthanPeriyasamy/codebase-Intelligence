import { z } from 'zod';

export const branchSchema = z.string().trim().max(200).refine(value => value === '' || (!value.startsWith('-') && !value.startsWith('/') && !value.endsWith('/') && !value.includes('..') && !value.includes('@{') && !/[\s~^:?*\[\\\x00-\x1f]/.test(value)), 'Enter a branch name, not a revision expression.');
export const remoteSchema = z.string().trim().max(2048).refine(value => {
  try { const url = new URL(value); return /^(https|ssh):\/\//.test(value) && !/[\s\\]/.test(value) && /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(url.hostname) && !url.password && !url.search && !url.hash && (url.protocol === 'ssh:' ? !url.username || /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(url.username) : !url.username); }
  catch { return /^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9_./-]+$/.test(value) && !value.includes('..'); }
}, 'Use an HTTPS or SSH Git URL without embedded tokens.');
const count = z.number().int().nonnegative();
export const snapshotSchema = z.object({
  commit: z.string().regex(/^[a-f0-9]{40,64}$/), files: count, parsed: count, documentOnly: count, unsupported: count, excluded: count, failed: count,
  added: count, modified: count, deleted: count, renamed: count, reused: count, affected: count, analyzer: z.string().max(100),
}).strict().refine(value => value.parsed + value.documentOnly + value.unsupported + value.excluded + value.failed === value.files && value.reused <= value.files, 'Invalid coverage totals');
export type Snapshot = z.infer<typeof snapshotSchema>;
export const noticeSchema = z.object({ id: z.string().uuid(), time: z.string().datetime(), kind: z.enum(['info', 'success', 'error']), title: z.string().max(120), body: z.string().max(500), read: z.boolean() }).strict();
export const repositoryViewSchema = z.object({
  workspacePath: z.string().max(8192).optional(), sourceFolder: z.string().max(8192).optional(),
  id: z.string().uuid(), name: z.string().max(200), branch: z.string().max(200), kind: z.enum(['local', 'remote']),
  active: snapshotSchema.nullable(), autoSync: z.boolean(), lastChecked: z.string().datetime().nullable(),
}).strict();
export const repositoryStatusSchema = z.object({
  workspaceFolder: z.string().max(8192).optional(), repository: repositoryViewSchema.nullable(), phase: z.enum(['idle', 'cloning', 'checking', 'indexing', 'ready', 'error', 'cancelled']),
  processed: count, total: count, error: z.string().max(500).nullable(), notices: z.array(noticeSchema).max(100),
}).strict();
export type RepositoryStatus = z.infer<typeof repositoryStatusSchema>;
export const snapshotEventSchema = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('progress'), processed: count, total: count }).strict(),
  z.object({ v: z.literal(1), type: z.literal('complete'), snapshot: snapshotSchema }).strict(),
  z.object({ v: z.literal(1), type: z.literal('failure'), code: z.enum(['GIT', 'STORAGE', 'LIMIT', 'RUNTIME', 'INVALID']) }).strict(),
]);
