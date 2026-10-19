const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Workspace } = require('./workspace.cjs');
const { stopChild } = require('../scripts/run-services.cjs');
const root = path.resolve(__dirname, '..');
app.setName('DeepWiki Studio');
app.setAppUserModelId('com.deepwiki.studio');
const origin = 'http://127.0.0.1:3000';
const workspace = new Workspace();
let window, services, stopping = false, dirty = false, allowClose = false;
let startupError = '';

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== origin || new URL(event.senderFrame.url).pathname !== '/desktop') {
    throw new Error('Untrusted desktop request');
  }
}
function shutdown() {
  if (stopping) return;
  stopping = true;
  if (services) stopChild(services);
}
async function boot() {
  window = new BrowserWindow({ width: 1540, height: 960, minWidth: 1000, minHeight: 650,
    title: 'DeepWiki Studio', backgroundColor: '#101218', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.on('close', event => {
    if (dirty && !allowClose) {
      const decision = dialog.showMessageBoxSync(window, { type: 'warning', message: 'Discard unsaved editor changes and close?', buttons: ['Keep editing', 'Discard and close'], defaultId: 0, cancelId: 0 });
      if (decision === 0) { event.preventDefault(); return; }
      allowClose = true;
    }
    shutdown();
  });
  window.on('closed', () => { shutdown(); app.quit(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === origin) {
      const docs = new BrowserWindow({ parent: window, width: 1200, height: 850, autoHideMenuBar: true,
        backgroundColor: '#101218', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
      docs.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== origin) event.preventDefault(); });
      docs.webContents.setWindowOpenHandler(({ url: target }) => {
        if (/^https?:\/\//.test(target)) void shell.openExternal(target);
        return { action: 'deny' };
      });
      void docs.loadURL(url);
    } else if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-prevent-unload', event => { if (allowClose) event.preventDefault(); });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  await window.loadURL('data:text/html,' + encodeURIComponent('<body style="background:#101218;color:#dce3f1;font:16px system-ui;padding:70px"><h1>DeepWiki Studio</h1><p>Starting your workspace…</p><p style="color:#8490a5">Connecting the Python backend and editor.</p></body>'));
  services = spawn(process.env.DEEPWIKI_NODE || 'node', [path.join(root, 'scripts/run-services.cjs')], {
    cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, detached: process.platform !== 'win32',
  });
  for (const stream of [services.stdout, services.stderr]) stream.on('data', chunk => {
    process.stdout.write(chunk); startupError = (startupError + chunk).slice(-5000);
  });
  services.on('error', error => fail(error.message));
  services.on('exit', code => { if (!stopping) fail(`Services stopped (${code}).\n${startupError}`); });
  services.on('message', async message => {
    if (message.type === 'ready' && !stopping) {
      try { await window.loadURL(origin + '/desktop'); } catch (error) { fail(error.message); }
    }
  });
}
function fail(message) {
  if (stopping) return;
  dialog.showErrorBox('DeepWiki could not start', message);
  allowClose = true; shutdown(); app.quit();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.restore(); window.focus(); } });
  app.whenReady().then(() => {
    ipcMain.handle('workspace:choose', async event => {
      trusted(event);
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Open a code workspace' });
      return result.canceled ? null : workspace.select(result.filePaths[0]);
    });
    for (const method of ['list', 'read', 'save', 'create']) ipcMain.handle(`workspace:${method}`, (event, request) => {
      trusted(event); return workspace[method](request);
    });
    ipcMain.on('workspace:dirty', (event, value) => { trusted(event); dirty = value === true; });
    return boot();
  }).catch(error => fail(error.message));
  app.on('window-all-closed', () => { shutdown(); app.quit(); });
  app.on('will-quit', shutdown);
  process.on('SIGINT', () => { allowClose = true; shutdown(); app.quit(); });
  process.on('SIGTERM', () => { allowClose = true; shutdown(); app.quit(); });
}
