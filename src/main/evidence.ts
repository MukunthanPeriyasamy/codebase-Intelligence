import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { childEnvironment, RepoError } from './git';
import { stopOwnedProcess } from './processes';
import { planSchema, symbolSchema, type SnapshotRef, type DocUnit, type Evidence, type Generated } from '../shared/documentation';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sensitivePath = /(^|\/)(\.env(?:\..*)?|id_(rsa|ed25519)|credentials(?:\..*)?|secrets?(?:\..*)?)$|\.(pem|key|p12|pfx)$/i;
const secret = /-----BEGIN .*PRIVATE KEY-----|\b(?:sk-or-v1-|sk-[a-zA-Z0-9]{10}|gh[pousr]_|github_pat_|AKIA[0-9A-Z]{12}|xox[baprs]-)|(?:api[_-]?key|secret|password|token|authorization)\s*[:=]\s*["']?[^\s"']{8,}|https?:\/\/[^\s/]+:[^\s/]+@/i;
export function containsSecret(text: string): boolean { return secret.test(text); }
export function redact(path: string, text: string, start: number, alreadyBlocked: number[] = []) {
  const blocked = new Set(alreadyBlocked);
  let privateBlock = false; let bytes = 0;
  const lines = text.split('\n').map((line, index) => {
    const number = start + index;
    if (/-----BEGIN .*PRIVATE KEY-----/.test(line)) privateBlock = true;
    const hidden = sensitivePath.test(path) || privateBlock || secret.test(line) || Buffer.byteLength(line) > 12000 || bytes + Buffer.byteLength(line) > 12000;
    if (/-----END .*PRIVATE KEY-----/.test(line)) privateBlock = false;
    if (hidden || blocked.has(number)) { blocked.add(number); return '[REDACTED OR OMITTED]'; }
    bytes += Buffer.byteLength(line) + 1; return line;
  });
  return { text: lines.join('\n'), blocked: [...blocked].sort((a, b) => a - b) };
}

export class EvidenceReader {
  constructor(private readonly python: string, private readonly script: string) {}
  protected request(ref: SnapshotRef, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, ['-I', '-u', this.script], { env: childEnvironment(), windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' });
      let output = ''; let failed = false;
      const abort = () => { failed = true; stopOwnedProcess(child); };
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 60000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { output += chunk; if (Buffer.byteLength(output) > 12 * 1024 * 1024) abort(); });
      child.stderr.resume(); child.stdin.on('error', () => { failed = true; }); child.on('error', () => { failed = true; });
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        try {
          if (failed || code !== 0) throw new Error('worker');
          const response = z.object({ ok: z.literal(true), data: z.unknown() }).strict().parse(JSON.parse(output));
          resolve(response.data);
        } catch { reject(new RepoError('Committed evidence could not be verified. Re-sync the repository or retry.')); }
      });
      child.stdin.end(JSON.stringify({ directory: ref.directory, commit: ref.commit, ...input }) + '\n');
      if (signal?.aborted) abort();
    });
  }
  async checkTool() { return this.request({ directory: '', commit: '' } as SnapshotRef, { operation: 'health' }); }
  async retrieveTool(ref: SnapshotRef, question: string, expanded: boolean, signal: AbortSignal) { return this.request(ref, { operation: 'retrieve', question, expanded }, signal); }
  async plan(ref: SnapshotRef, signal?: AbortSignal) { return planSchema.parse(await this.request(ref, { operation: 'plan' }, signal)); }
  async read(ref: SnapshotRef, unit: DocUnit, signal?: AbortSignal): Promise<Evidence> {
    const raw = z.object({ text: z.string().max(1500000), blocked: z.array(z.number().int()), symbols: z.array(symbolSchema).max(100) }).strict().parse(await this.request(ref, { operation: 'source', path: unit.path, hash: unit.hash, start: unit.start, end: unit.end }, signal));
    return { id: unit.id, path: unit.path, hash: unit.hash, start: unit.start, end: unit.end, ...redact(unit.path, raw.text, unit.start, raw.blocked), symbols: raw.symbols };
  }
}

export function validateClaims(content: Generated, evidence: Evidence[]): void {
  if (containsSecret(JSON.stringify(content))) throw new RepoError('The model response may contain sensitive content and was not published.');
  const lookup = new Map(evidence.map(item => [item.id, item]));
  for (const section of content.sections) {
    if (section.kind === 'function' && !evidence.some(item => item.symbols.some(symbol => symbol.id === section.symbolId))) throw new RepoError('The model referenced a function outside the supplied evidence.');
    for (const claim of section.claims) for (const citation of claim.citations) {
      const item = lookup.get(citation.evidenceId);
      if (!item || citation.start < item.start || citation.end > item.end || citation.end < citation.start || item.blocked.some(line => line >= citation.start && line <= citation.end)) throw new RepoError('The model returned an invalid or redacted citation. The response was not published.');
      const text = item.text.split('\n').slice(citation.start - item.start, citation.end - item.start + 1).join('\n');
      if (!citation.quote.trim() || !text.includes(citation.quote)) throw new RepoError('A model citation did not match its source. The response was not published.');
    }
  }
}
