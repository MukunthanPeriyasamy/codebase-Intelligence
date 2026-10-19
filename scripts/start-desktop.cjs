const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
// Monaco's workers and language assets are served locally, never from a CDN.
fs.cpSync(path.join(root, 'node_modules/monaco-editor/min/vs'), path.join(root, 'public/vendor/monaco/vs'), { recursive: true });
const env = { ...process.env, DEEPWIKI_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(root, 'electron/main.cjs')], { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
