const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MAX_BYTES = 2 * 1024 * 1024;
const hidden = new Set(['.git', 'node_modules', '.next', '.local', '.venv', '__pycache__']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

class Workspace {
  root = null;
  async select(folder) {
    const root = await fs.realpath(folder);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Choose a directory');
    this.root = root;
    return { root, name: path.basename(root) };
  }
  async resolve(workspace, relative = '') {
    if (!this.root || workspace !== this.root) throw new Error('Workspace changed. Reopen the file.');
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes(':')) throw new Error('Use a workspace-relative path');
    const target = path.resolve(this.root, relative);
    const inside = candidate => candidate === this.root || candidate.startsWith(this.root + path.sep);
    if (!inside(target)) throw new Error('Path is outside the workspace');
    const real = await fs.realpath(target);
    if (!inside(real)) throw new Error('Links outside the workspace cannot be opened');
    return real;
  }
  async list({ workspace, relative = '' }) {
    const folder = await this.resolve(workspace, relative);
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries.filter(e => !hidden.has(e.name) && !e.isSymbolicLink()).map(e => ({
      name: e.name, path: path.posix.join(relative.replaceAll('\\', '/'), e.name), directory: e.isDirectory(),
    })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  async read({ workspace, relative }) {
    const target = await this.resolve(workspace, relative);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Open a text file smaller than 2 MB');
    const bytes = await fs.readFile(target);
    if (bytes.includes(0)) throw new Error('Binary files are not supported in the editor');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { text, hash: digest(bytes) };
  }
  async save({ workspace, relative, text, hash }) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('File exceeds the 2 MB limit');
    const target = await this.resolve(workspace, relative);
    const current = await fs.readFile(target);
    if (digest(current) !== hash) throw new Error('File changed on disk. Reload it before saving; your editor text is preserved.');
    await fs.writeFile(target, text, 'utf8');
    return { hash: digest(Buffer.from(text)), text };
  }
  async create({ workspace, relative, directory = false }) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes(':')) throw new Error('Enter a relative path');
    const parent = await this.resolve(workspace, path.dirname(relative));
    const name = path.basename(relative);
    if (name === '.' || name === '..') throw new Error('Invalid name');
    const target = path.join(parent, name);
    if (directory) await fs.mkdir(target);
    else await fs.writeFile(target, '', { flag: 'wx' });
  }
}
module.exports = { Workspace };
