/* Resolve an isolated MCP runtime; do not install CGC into the FastAPI environment. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.local', 'kg-mcp.json');
if (fs.existsSync(configPath)) {
  console.log('KG configuration already exists at .local/kg-mcp.json; preserving it.');
  process.exit(0);
}
const python = path.join(root, '.local', 'deepwiki-tool', 'runtime', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const env = { ...process.env, UV_CACHE_DIR: path.join(root, '.local/uv-cache'),
  UV_TOOL_DIR: path.join(root, '.local/uv-tools'), UV_PYTHON_INSTALL_DIR: path.join(root, '.local/uv-python') };
const args = [...(fs.existsSync(python) ? ['--python', python] : []), '--from', 'codegraphcontext==0.5.1',
  'python', '-c', 'import sys; print(sys.executable)'];
const result = spawnSync('uvx', args, { cwd: root, env, encoding: 'utf8', windowsHide: true });
if (result.status !== 0) {
  console.error(result.error?.message || result.stderr || 'Install uv, then retry npm run setup:kg.');
  process.exit(1);
}
const runtimePython = result.stdout.trim().split(/\r?\n/).pop();
if (!fs.existsSync(runtimePython)) throw new Error('Could not resolve the MCP runtime');
const executable = path.join(path.dirname(runtimePython), process.platform === 'win32' ? 'codegraphcontext.exe' : 'codegraphcontext');
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({ command: executable, args: ['mcp', 'start'], cwd: root,
  env: { CGC_RUNTIME_DB_TYPE: 'kuzudb', CGC_EMBEDDED_BUFFER_POOL_MB: '512',
    LOG_FILE_PATH: path.join(root, '.local/logs/cgc.log') } }, null, 2));
console.log('KG MCP configured. Restart DeepWiki and type / in chat. Indexing is explicit.');
