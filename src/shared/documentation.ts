import { z } from 'zod';

export const DOC_VERSION = 'docs-v1';
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const docSettingsSchema = z.object({
  provider: z.literal('ollama').optional(),
  model: z.string().trim().max(150).refine(value => value === '' || /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(value)),
  embeddingModel: z.string().trim().max(150).refine(value => value === '' || /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(value)).optional(),
  autoGenerate: z.boolean(), requestsPerRun: z.number().int().min(1).max(20), requestsPerDay: z.number().int().min(1).max(200),
  maxOutputTokens: z.number().int().min(512).max(16384),
}).strict();
export type DocSettings = z.infer<typeof docSettingsSchema>;
export const defaultDocSettings: DocSettings = { provider: 'ollama', model: '', autoGenerate: false, requestsPerRun: 1, requestsPerDay: 20, maxOutputTokens: 8000 };
export const symbolSchema = z.object({ id: z.string().max(8192), name: z.string().max(1000), kind: z.string().max(80), start: z.number().int().positive(), end: z.number().int().positive() }).strict();
export const evidenceSchema = z.object({ id: digestSchema, path: z.string().max(4096), hash: digestSchema, start: z.number().int().positive(), end: z.number().int().positive(), text: z.string().max(16000), blocked: z.array(z.number().int().positive()).max(120), symbols: z.array(symbolSchema).max(100) }).strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export const citationSchema = z.object({ evidenceId: digestSchema, start: z.number().int().positive(), end: z.number().int().positive(), quote: z.string().min(1).max(300) }).strict();
export const claimSchema = z.object({ text: z.string().min(1).max(1200), basis: z.enum(['inferred', 'uncertain']), citations: z.array(citationSchema).min(1).max(4) }).strict();
export const generatedSchema = z.object({
  title: z.string().min(1).max(180),
  sections: z.array(z.object({ title: z.string().min(1).max(180), kind: z.enum(['module', 'function', 'workflow']), symbolId: z.string().max(8192).nullable(), claims: z.array(claimSchema).min(1).max(8) }).strict()).min(1).max(12),
  gaps: z.array(z.string().min(1).max(400)).max(20),
}).strict();
export type Generated = z.infer<typeof generatedSchema>;
export const snapshotRefSchema = z.object({ repoId: z.string().uuid(), repoName: z.string().max(200), commit: z.string().regex(/^[a-f0-9]{40,64}$/), directory: z.string().max(8192), analyzer: z.string().max(100) }).strict();
export type SnapshotRef = z.infer<typeof snapshotRefSchema>;
export const unitSchema = z.object({ id: digestSchema, kind: z.enum(['module', 'workflow']), path: z.string().max(4096), hash: digestSchema, start: z.number().int().positive(), end: z.number().int().positive() }).strict();
export type DocUnit = z.infer<typeof unitSchema>;
export const planSchema = z.object({ units: z.array(unitSchema).max(2000), omitted: z.number().int().nonnegative(), excluded: z.number().int().nonnegative() }).strict();
export type DocPlan = z.infer<typeof planSchema>;
export const pageSchema = z.object({ id: digestSchema, repoId: z.string().uuid(), commit: z.string().regex(/^[a-f0-9]{40,64}$/), model: z.string().max(150), servedModel: z.string().max(150), promptVersion: z.literal(DOC_VERSION), analyzer: z.string().max(100), kind: z.enum(['module', 'workflow']), evidence: z.array(evidenceSchema).max(6), content: generatedSchema, inputHash: digestSchema, created: z.string().datetime(), cost: z.number().nonnegative().nullable() }).strict();
export type DocPage = z.infer<typeof pageSchema>;
export const catalogEntrySchema = z.object({ id: digestSchema, title: z.string().max(180), kind: z.enum(['module', 'workflow']), path: z.string().max(4096) }).strict();
export const catalogSchema = z.array(catalogEntrySchema).max(2000);
export type DocCatalog = z.infer<typeof catalogSchema>;
export const docStatusSchema = z.object({
  settings: docSettingsSchema, phase: z.enum(['idle', 'planning', 'generating', 'partial', 'ready', 'cancelled', 'error']),
  commit: z.string().nullable(), sourceCommit: z.string().nullable(), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(), omitted: z.number().int().nonnegative(), requestsToday: z.number().int().nonnegative(),
  error: z.string().max(500).nullable(), reportedCost: z.number().nonnegative(), unknownCostRequests: z.number().int().nonnegative(),
  gaps: z.array(z.string().max(500)).max(20),
}).strict();
export type DocStatus = z.infer<typeof docStatusSchema>;
