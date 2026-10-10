import { z } from 'zod';

// Gemini accepts a subset of JSON Schema. Publication still uses the original
// Zod schema; wire descriptions guide constraints that its schema cannot express.
export function completionSchema(schema: z.ZodType, model: string): unknown {
  const json = z.toJSONSchema(schema, { target: 'draft-7' });
  if (!model.startsWith('google/gemini-')) return json;
  function adapt(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const node = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const hints: string[] = [];
    for (const [key, item] of Object.entries(node)) {
      if (key === '$schema') continue;
      if (['minLength', 'maxLength', 'pattern'].includes(key)) { hints.push(`${key}: ${item}`); continue; }
      if (key === 'exclusiveMinimum' && node.type === 'integer' && typeof item === 'number') { out.minimum = Math.floor(item) + 1; continue; }
      if (key === 'properties') out.properties = Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, child]) => [name, adapt(child)]));
      else if (key === 'items' || key === 'additionalProperties') out[key] = adapt(item);
      else if (key === 'anyOf' && Array.isArray(item) && item.length === 2 && item.some(child => child.type === 'null')) {
        const other = item.find(child => child.type !== 'null');
        const adapted = adapt(other) as Record<string, unknown>;
        Object.assign(out, adapted, { type: [other.type, 'null'] });
      } else out[key] = item;
    }
    if (hints.length) out.description = [out.description, ...hints].filter(Boolean).join('; ');
    return out;
  }
  return adapt(json);
}
