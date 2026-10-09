import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export const python = process.env.CODEBASE_INTELLIGENCE_PYTHON ?? resolve('.research/venv/Scripts/python.exe');
export async function temporary(prefix: string) {
  const root = resolve('.local/tests');
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, prefix));
}
export async function until(check: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('Condition timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
