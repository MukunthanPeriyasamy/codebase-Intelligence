import { z } from 'zod';
import { digestSchema, evidenceSchema, generatedSchema, unitSchema } from './documentation';

export const CHAT_VERSION = 'chat-v3-ollama';
export const questionSchema = z.string().trim().min(1).max(2000);
export const retrievalSchema = z.object({
  units: z.array(unitSchema).max(12), exact: z.boolean(), route: z.enum(['symbol', 'source', 'graph']),
  gaps: z.array(z.string().max(500)).max(20), scanned: z.number().int().nonnegative(),
  edges: z.array(z.object({ path: z.string().max(4096), line: z.number().int().positive(), target: z.string().max(1000), resolution: z.literal('unresolved') }).strict()).max(24),
}).strict();
export type Retrieval = z.infer<typeof retrievalSchema>;
export const answerSchema = z.object({
  id: z.string().uuid(), repoId: z.string().uuid(), commit: z.string().regex(/^[a-f0-9]{40,64}$/),
  question: questionSchema, mode: z.enum(['direct', 'model', 'insufficient']), cached: z.boolean(),
  model: z.string().max(150), servedModel: z.string().max(150), content: generatedSchema.nullable(),
  evidence: z.array(evidenceSchema).max(6), gaps: z.array(z.string().max(500)).max(20),
  route: z.enum(['symbol', 'source', 'graph']), expanded: z.boolean(), documents: z.number().int().nonnegative(),
  quality: z.object({ score: z.number().int().min(0).max(100), reasons: z.array(z.string().max(300)).max(5), sources: z.array(z.object({ evidenceId: digestSchema, path: z.string().max(4096), start: z.number().int().positive(), end: z.number().int().positive(), document: z.boolean(), codebase: z.boolean(), kg: z.boolean() }).strict()).max(6) }).strict(),
  created: z.string().datetime(), cost: z.number().nonnegative().nullable(), fingerprint: digestSchema,
}).strict();
export type ChatAnswer = z.infer<typeof answerSchema>;
export const chatStatusSchema = z.object({ phase: z.enum(['idle', 'retrieving', 'answering', 'ready', 'error', 'cancelled']), error: z.string().max(500).nullable(), answers: z.array(answerSchema).max(20) }).strict();
export type ChatStatus = z.infer<typeof chatStatusSchema>;
