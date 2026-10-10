import { z } from 'zod';
import type { DocSettings } from '../shared/documentation';
import { ProviderError } from './ollama';
import { completionSchema } from './provider-schema';
import { modelCatalogSchema } from '../shared/models';

async function rejectionReason(response: Response): Promise<string> {
  // Classify bounded provider diagnostics, never expose echoed prompts or keys.
  const reader = response.body?.getReader(); if (!reader) return '';
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 65536) return '';
      chunks.push(value);
    }
    const parsed = z.object({ error: z.object({ message: z.string().optional(), metadata: z.object({ raw: z.string().optional() }).optional() }) }).safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) return '';
    const message = `${parsed.data.error.message ?? ''} ${parsed.data.error.metadata?.raw ?? ''}`;
    if (/schema|response_format|responseSchema|structured.output/i.test(message)) {
      const keyword = ['exclusiveMinimum', 'minLength', 'maxLength', 'pattern', 'additionalProperties', 'anyOf'].find(word => message.includes(word));
      return `Provider reported a structured-output rejection${keyword ? ` involving ${keyword}` : ''}. Schema compatibility or endpoint support needs checking; no automatic retry.`;
    }
    if (/no endpoints|no available provider/i.test(message)) return 'No compatible provider endpoint was available. Check model availability; resume explicitly.';
    if (/max_tokens|token limit|context length/i.test(message)) return 'Provider reported a token/context limit rejection. Review output limits in Settings.';
    return '';
  } catch { return ''; }
  finally { await reader.cancel().catch(() => undefined); }
}

async function request(path: 'chat/completions' | 'models' | 'embeddings/models', key: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`https://openrouter.ai/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(body === undefined ? 20000 : 120000), ...(signal ? [signal] : [])]), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const detail = response.status === 400 ? await rejectionReason(response) : '';
    if (response.status !== 400) await response.body?.cancel();
    const reasons: Record<number, string> = { 400: detail || 'OpenRouter rejected the request; the cause could not be identified. Model support is not confirmed by this error.', 401: 'API key rejected. Replace it in Settings.', 402: 'Insufficient OpenRouter credits.', 403: 'Access denied for this model.', 404: 'Model or compatible endpoint not found.', 429: 'Rate limit reached. Resume later.' };
    throw new ProviderError(`[HTTP ${response.status}] ${reasons[response.status] ?? 'OpenRouter could not complete the request. Resume later.'}`, null);
  }
  const reader = response.body?.getReader(); if (!reader) throw new ProviderError('[empty-response] OpenRouter returned no body.', null);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > (body === undefined ? 16 : 2) * 1024 * 1024) { await reader.cancel(); throw new ProviderError('[response-size] OpenRouter response exceeded the safety limit.', null); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new ProviderError('[response-json] OpenRouter returned invalid JSON.', null); }
}
export async function openRouterCompletion<T>(settings: DocSettings, schema: z.ZodType<T>, prompt: string, data: unknown, key: string, signal: AbortSignal) {
  let cost: number | null = null;
  const fail = (message: string): never => { throw new ProviderError(message, cost); };
  try {
    const input = JSON.stringify(data); if (Buffer.byteLength(input) > 16000) throw new ProviderError('Evidence exceeds the input limit. Nothing was sent.', 0);
    const raw = await request('chat/completions', key, { model: settings.model, stream: false, max_tokens: settings.maxOutputTokens, provider: { require_parameters: true, allow_fallbacks: false }, response_format: { type: 'json_schema', json_schema: { name: 'repository_response', strict: true, schema: completionSchema(schema, settings.model) } }, messages: [{ role: 'system', content: prompt + ` Return compact JSON within ${settings.maxOutputTokens} output tokens.` }, { role: 'user', content: input }] }, signal);
    const payload = z.object({ error: z.unknown().optional(), model: z.string().max(150).optional(), usage: z.object({ cost: z.number().nonnegative().nullable().optional(), completion_tokens: z.number().int().nonnegative().optional() }).nullish(), choices: z.array(z.object({ finish_reason: z.string().nullish(), message: z.object({ content: z.string().max(100000).nullish(), refusal: z.unknown().optional() }).optional() })).max(1).optional() }).safeParse(raw);
    if (!payload.success) return fail('[response-envelope] OpenRouter returned an invalid response structure.');
    cost = payload.data.usage?.cost ?? null; const choice = payload.data.choices?.[0];
    if (payload.data.error != null) return fail('[provider-error] OpenRouter returned a provider error. Check model availability.');
    if (choice?.finish_reason === 'length') return fail(`[output-truncated] Output limit ${settings.maxOutputTokens} reached; completion tokens ${payload.data.usage?.completion_tokens ?? 'unknown'}. Increase Output tokens per request, save and resume. No automatic retry.`);
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) return fail('[response-refused] The provider refused or filtered this request.');
    if (choice?.finish_reason !== 'stop') return fail('[incomplete-response] The provider did not finish normally. Resume explicitly.');
    if (!choice.message?.content?.trim() || !payload.data.model) return fail('[empty-content] OpenRouter returned no document or served model.');
    let content: unknown;
    try { content = JSON.parse(choice.message.content); } catch { return fail('[document-json] Model output is invalid JSON. Try a larger output limit or another JSON-schema model.'); }
    const validated = schema.safeParse(content); if (!validated.success) return fail('[document-schema] Model output does not match the required schema. Choose another JSON-schema model.');
    return { content: validated.data, cost, servedModel: payload.data.model };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return fail(signal.aborted ? 'Request cancelled. It may have been billed; resume explicitly.' : '[connection] OpenRouter is unavailable or timed out after two minutes. Check your connection. No automatic retry.');
  }
}
export async function listOpenRouterModels(kind: 'chat' | 'embedding', key: string) {
  try {
    const row = z.object({ id: z.string().min(1).max(150), name: z.string().max(300), context_length: z.number().int().nonnegative().nullish(), pricing: z.object({ prompt: z.string().max(40).optional(), completion: z.string().max(40).optional() }).optional(), supported_parameters: z.array(z.string()).optional(), architecture: z.object({ input_modalities: z.array(z.string()), output_modalities: z.array(z.string()) }).optional() });
    const payload = z.object({ data: z.array(row).max(10000) }).parse(await request(kind === 'chat' ? 'models' : 'embeddings/models', key));
    return modelCatalogSchema.parse({ kind, fetched: new Date().toISOString(), models: payload.data.filter(item => !item.architecture || (item.architecture.input_modalities.includes('text') && item.architecture.output_modalities.includes(kind === 'chat' ? 'text' : 'embeddings'))).map(item => ({ id: item.id, name: item.name, context: item.context_length ?? null, inputPrice: item.pricing?.prompt ?? null, outputPrice: item.pricing?.completion ?? null, structured: item.supported_parameters?.includes('structured_outputs') ?? false })) });
  } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('OpenRouter catalog is unavailable. Check your key and connection, then refresh.', 0); }
}
