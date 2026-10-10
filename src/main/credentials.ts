import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RepoError } from './git';
interface Encryption { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
export class CredentialStore {
  private readonly file: string;
  constructor(private readonly directory: string, private readonly encryption: Encryption) { this.file = join(directory, 'openrouter.enc'); }
  async status() {
    const available = this.encryption.available();
    try { await readFile(this.file); if (!available) return { available, configured: false, error: 'OS encryption is unavailable. Unlock your key store.' }; await this.read(); return { available, configured: true, error: null }; }
    catch (error) { return { available, configured: false, error: (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'The saved OpenRouter key cannot be read. Remove it and save a new key.' }; }
  }
  async read() {
    if (!this.encryption.available()) throw new RepoError('OS encryption is unavailable. Unlock your key store.');
    try { const value = this.encryption.decrypt(await readFile(this.file)); if (!/^[\x21-\x7E]{8,512}$/.test(value)) throw new Error(); return value; }
    catch { throw new RepoError('Save a usable OpenRouter API key in Settings.'); }
  }
  async save(key: string) {
    if (!this.encryption.available()) throw new RepoError('OS encryption is unavailable; the key was not saved.');
    if (!/^[\x21-\x7E]{8,512}$/.test(key)) throw new RepoError('Enter a valid API key without spaces.');
    await mkdir(this.directory, { recursive: true }); const temp = this.file + '.' + randomUUID();
    await writeFile(temp, this.encryption.encrypt(key), { mode: 0o600 }); await rename(temp, this.file);
  }
  async clear() { try { await unlink(this.file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
}
