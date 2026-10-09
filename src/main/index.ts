import { GraphReader } from './graph';
import { listModels } from './models';
import { DocumentationService } from './documentation';
import { EvidenceReader } from './evidence';
import { ChatService } from './chat';
import { RetrievalReader } from './retrieval';
import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { actionSchema, type DesktopStatus, type Result } from '../shared/contracts';
import { WorkerService } from './worker';
import { APP_URL, CSP, trustedSender } from './security';
import { RepositoryService } from './repositories';
import { RepoError } from './git';

protocol.registerSchemesAsPrivileged([{ scheme: 'codebase', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Codebase Intelligence');
// A host-only override keeps integration tests isolated from real application data.
if (!app.isPackaged && process.env.CODEBASE_INTELLIGENCE_DATA_DIR) app.setPath('userData', resolve(process.env.CODEBASE_INTELLIGENCE_DATA_DIR));
let window: BrowserWindow | null = null;
let worker: WorkerService | null = null;
let ollamaStatus: DesktopStatus['ollama'] = { connected: false, error: null };
let quitting = false;
let repositories: RepositoryService;
let documentation: DocumentationService;
let chat: ChatService;
let selectingRepository = false;
let graphReader: GraphReader;
let graphBusy = false;
const graphController = new AbortController();

function status(): DesktopStatus {
  return { worker: worker?.status ?? { state: 'stopped', error: null, python: null, storageReady: false }, ollama: ollamaStatus,
    docs: documentation.status, chat: chat.status, sync: repositories?.status ?? { repository: null, phase: 'idle', processed: 0, total: 0, error: null, notices: [] } };
}
function publish() {
  if (window && !window.isDestroyed() && window.webContents.getURL() === APP_URL) window.webContents.send('desktop:status', status());
}
function createWindow() {
  window = new BrowserWindow({ width: 1180, height: 820, minWidth: 760, minHeight: 620, show: false, backgroundColor: '#101416', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  void window.loadURL(APP_URL);
}

async function installAppProtocol() {
  const root = join(__dirname, 'renderer');
  const files = new Map<string, string>([['/index.html', join(root, 'index.html')]]);
  for (const file of await readdir(join(root, 'assets'))) {
    if (/^[a-zA-Z0-9_.-]+\.(js|css)$/.test(file)) files.set(`/assets/${file}`, join(root, 'assets', file));
  }
  protocol.handle('codebase', async request => {
    const url = new URL(request.url);
    const file = files.get(url.pathname);
    if (url.host !== 'app' || url.search || !file || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const mime = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    try { return new Response(new Uint8Array(await readFile(file)), { headers: { 'Content-Type': mime, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } }); }
    catch { return new Response('Unavailable', { status: 500 }); }
  });
}

async function dispatch(input: unknown): Promise<Result> {
  if (quitting) return { ok: false, error: { code: 'BUSY', message: 'The application is shutting down.' } };
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'REQUEST_INVALID', message: 'The request is invalid.' } };
  const action = parsed.data;
  if (action.type === 'workspace.choose') {
    if (!window || selectingRepository) throw new RepoError('A folder picker is already open.');
    if (['planning', 'generating'].includes(documentation.status.phase)) throw new RepoError('Stop documentation generation before changing its workspace.');
    selectingRepository = true;
    try {
      const choice = await dialog.showOpenDialog(window, { title: 'Choose workspace folder', defaultPath: repositories.status.workspaceFolder, properties: ['openDirectory', 'createDirectory'] });
      if (!choice.canceled && choice.filePaths[0]) { await repositories.chooseWorkspace(choice.filePaths[0]); await documentation.exportCurrent(); }
    } finally { selectingRepository = false; }
  }
  if (action.type === 'workspace.open') {
    const folder = repositories.workspaceLocation();
    if (!folder) throw new RepoError('Choose a workspace folder first.');
    const error = await shell.openPath(folder); if (error) throw new RepoError('The workspace folder could not be opened. Check that it is still available.');
  }
  if (action.type === 'docs.export') { if (!documentation.status.commit) throw new RepoError('Generate documentation before exporting Markdown.'); await documentation.exportCurrent(); }
  if (action.type === 'repository.graph') {
    if (graphBusy) return { ok: false, error: { code: 'BUSY', message: 'Graph refresh is already in progress.' } };
    const target = repositories.getGraphSnapshot();
    if (!target) return { ok: true, status: status(), graph: null };
    graphBusy = true;
    try {
      const graph = await graphReader.readGraph(target.ref, target.preview, graphController.signal);
      if (repositories.status.repository?.id !== target.ref.repoId) return { ok: true, status: status(), graph: null };
      return { ok: true, status: status(), graph };
    } finally { graphBusy = false; }
  }
  if (action.type === 'models.list' || action.type === 'ollama.test') {
    try {
      const models = await listModels(action.type === 'models.list' ? action.kind : 'chat');
      ollamaStatus = { connected: true, error: null }; publish();
      return { ok: true, status: status(), models };
    } catch (error) {
      ollamaStatus = { connected: false, error: error instanceof RepoError ? error.message : 'Ollama connection failed.' }; publish(); throw error;
    }
  }
  if (action.type === 'chat.ask') chat.start(action.question);
  if (action.type === 'chat.cancel') await chat.cancel();
  if (action.type === 'chat.clear') await chat.clear();
  if (action.type === 'chat.citation') return { ok: true, status: status(), source: await chat.citation(action.id, action.section, action.claim, action.citation) };
  if (action.type === 'docs.configure') await documentation.configure(action.settings);
  if (action.type === 'docs.generate') { await documentation.refreshContext(); documentation.start(); }
  if (action.type === 'docs.cancel') await documentation.cancel();
  if (action.type === 'docs.catalog') return { ok: true, status: status(), catalog: documentation.catalog() };
  if (action.type === 'docs.page') return { ok: true, status: status(), document: await documentation.page(action.id) };
  if (action.type === 'docs.citation') return { ok: true, status: status(), source: await documentation.citation(action.id, action.section, action.claim, action.citation) };
  if (action.type === 'repository.local') {
    if (!window || selectingRepository) return { ok: false, error: { code: 'BUSY', message: 'Repository selection is already open.' } };
    selectingRepository = true;
    try {
      const choice = await dialog.showOpenDialog(window, { title: 'Connect a Git repository', properties: ['openDirectory'] });
      if (!choice.canceled && choice.filePaths[0]) await repositories.connect('local', choice.filePaths[0], action.branch);
    } finally { selectingRepository = false; }
  }
  if (action.type === 'repository.clone') { if (!repositories.status.workspaceFolder) throw new RepoError('Choose a workspace folder before cloning.'); await repositories.connect('remote', action.url, action.branch); }
  if (action.type === 'repository.sync') repositories.sync();
  if (action.type === 'repository.cancel') await repositories.cancel();
  if (action.type === 'repository.auto') await repositories.setAuto(action.enabled);
  if (action.type === 'repository.disconnect') await repositories.disconnect();
  if (action.type === 'notices.read') await repositories.markRead();
  if (action.type === 'worker.restart' && !await worker?.restart()) return { ok: false, error: { code: 'BUSY', message: 'The worker is restarting. Try again shortly.' } };
  if (action.type === 'worker.stop') { await repositories.cancel(); await chat.cancel(); await documentation.cancel(); await worker?.stop(); }
  publish();
  return { ok: true, status: status() };
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    await installAppProtocol();
    const developmentPython = join(app.getAppPath(), '.research', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = process.env.CODEBASE_INTELLIGENCE_PYTHON ?? (!app.isPackaged && existsSync(developmentPython) ? developmentPython : 'python');
    worker = new WorkerService({ python, script: join(__dirname, 'worker', 'service.py'), dataDir: join(app.getPath('userData'), 'knowledge') }, publish);
    graphReader = new GraphReader(python, join(__dirname, 'worker', 'graph.py'));
    repositories = new RepositoryService({ directory: join(app.getPath('userData'), 'knowledge'), python, script: join(__dirname, 'worker', 'snapshot.py') }, () => { chat?.contextChanged(); void documentation?.refreshContext(); publish(); });
    documentation = new DocumentationService({ knowledgeDirectory: join(app.getPath('userData'), 'knowledge'), reader: new EvidenceReader(python, join(__dirname, 'worker', 'evidence.py')), snapshot: () => repositories.getSnapshot(), workspaceProject: id => repositories.workspaceProject(id), changed: publish, notify: (kind, title, body) => repositories.notifyDocumentation(kind, title, body) });
    chat = new ChatService({ directory: join(app.getPath('userData'), 'knowledge'), snapshot: () => repositories.getSnapshot(), reader: new RetrievalReader(python, join(__dirname, 'worker', 'evidence.py')), docs: documentation, changed: publish });
    await documentation.initialize();
    await repositories.initialize();
    await documentation.refreshContext();
    ipcMain.handle('desktop:action', async (event, input: unknown): Promise<Result> => {
      if (!window || !trustedSender(event.sender.id, window.webContents.id, event.senderFrame === window.webContents.mainFrame, event.senderFrame?.url ?? '')) return { ok: false, error: { code: 'REQUEST_INVALID', message: 'This window cannot access desktop services.' } };
      try { return await dispatch(input); }
      catch (error) { return { ok: false, error: { code: 'INTERNAL', message: error instanceof RepoError ? error.message : 'The operation failed. Restart the app and try again.' } }; }
    });
    createWindow();
    await worker.restart();
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(() => { app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    graphController.abort();
    void Promise.all([worker?.stop(), repositories?.close(), chat?.close(), documentation?.close()]).finally(() => app.quit());
  });
}
