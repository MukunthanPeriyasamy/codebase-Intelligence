import { z } from 'zod';

export const modelEntrySchema = z.object({
  id: z.string().min(1).max(150), name: z.string().max(300),
  context: z.number().int().nonnegative().nullable(),
  inputPrice: z.string().max(40).nullable(), outputPrice: z.string().max(40).nullable(),
  structured: z.boolean(),
}).strict();
export const modelCatalogSchema = z.object({ kind: z.enum(['chat', 'embedding']), fetched: z.string().datetime(), models: z.array(modelEntrySchema).max(10000) }).strict();
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
