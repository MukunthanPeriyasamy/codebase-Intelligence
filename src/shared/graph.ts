import { z } from 'zod';

export const graphNodeSchema = z.object({ id: z.string().max(80), label: z.string().max(300), kind: z.enum(['file', 'symbol', 'unresolved']), path: z.string().max(4096), line: z.number().int().nonnegative(), detail: z.string().max(300) }).strict();
export const graphSchema = z.object({
  repoId: z.string().uuid(), commit: z.string().regex(/^[a-f0-9]{40,64}$/), preview: z.boolean(), files: z.number().int().nonnegative(), limited: z.boolean(),
  nodes: z.array(graphNodeSchema).max(240),
  edges: z.array(z.object({ id: z.string().max(80), source: z.string().max(80), target: z.string().max(80), kind: z.enum(['contains', 'calls']) }).strict()).max(400),
}).strict();
export type KnowledgeGraph = z.infer<typeof graphSchema>;
