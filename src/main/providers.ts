import { z } from 'zod';
import { generatedSchema, type DocSettings, type Evidence } from '../shared/documentation';
import { SYSTEM_PROMPT, structuredCompletion, ProviderError, type DocumentationProvider } from './ollama';
import { openRouterCompletion } from './openrouter';
export function completionRouter(readKey: () => Promise<string>) {
  return async function complete<T>(settings: DocSettings, schema: z.ZodType<T>, prompt: string, data: unknown, signal: AbortSignal) {
    if (settings.provider !== 'openrouter') return structuredCompletion(settings, schema, prompt, data, signal);
    let key: string; try { key = await readKey(); } catch { throw new ProviderError('Save a usable OpenRouter API key in Settings. Nothing was sent.', 0); }
    return openRouterCompletion(settings, schema, prompt, data, key, signal);
  };
}
export type ModelCompletion = ReturnType<typeof completionRouter>;
export class RoutedDocumentationProvider implements DocumentationProvider {
  constructor(private complete: ModelCompletion) {}
  generate(settings: DocSettings, kind: 'module' | 'workflow', evidence: Evidence[], signal: AbortSignal) { return this.complete(settings, generatedSchema, SYSTEM_PROMPT, { kind, evidence }, signal); }
}
