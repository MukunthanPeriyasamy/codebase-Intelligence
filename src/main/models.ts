import { z } from 'zod';
import { modelCatalogSchema, type ModelCatalog } from '../shared/models';
import { inspectModel, ollamaJson } from './ollama';
import { RepoError } from './git';

export async function listModels(kind: 'chat' | 'embedding', _key?: string, transport: typeof fetch = fetch): Promise<ModelCatalog> {
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const payload = z.object({ models: z.array(z.object({ name: z.string().min(1).max(150) })).max(100) }).parse(await ollamaJson('/api/tags', undefined, controller.signal, transport));
      const models: ModelCatalog['models'] = [];
      for (const item of payload.models) {
        if (/(?:^|[-:])cloud(?:$|[-:])/i.test(item.name)) continue;
        const info = await inspectModel(item.name, controller.signal, transport);
        if (!info.capabilities?.includes(kind === 'chat' ? 'completion' : 'embedding')) continue;
        models.push({ id: item.name, name: item.name, context: null, inputPrice: null, outputPrice: null, structured: kind === 'chat' });
      }
      return modelCatalogSchema.parse({ kind, fetched: new Date().toISOString(), models: models.sort((a, b) => a.id.localeCompare(b.id)) });
    } finally { clearTimeout(timer); }
  } catch { throw new RepoError('Ollama model list is unavailable. Start Ollama at 127.0.0.1:11434, install a local model and refresh. Use a current Ollama version with model capabilities.'); }
}
