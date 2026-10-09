import { contextBridge, ipcRenderer } from 'electron';
import { actionSchema, desktopStatusSchema, resultSchema, type Action, type DesktopBridge, type Result } from '../shared/contracts';

async function invoke(action: Action): Promise<Result> {
  if (!actionSchema.safeParse(action).success) return { ok: false, error: { code: 'REQUEST_INVALID', message: 'Check the input: use an HTTPS/SSH URL without tokens, a branch name, or a local Ollama model ID.' } };
  try { return resultSchema.parse(await ipcRenderer.invoke('desktop:action', action)); }
  catch { return { ok: false, error: { code: 'INTERNAL', message: 'Desktop services are unavailable. Restart the app.' } }; }
}
const bridge: DesktopBridge = {
  testOllama: () => invoke({ type: 'ollama.test' }),
  chooseWorkspace: () => invoke({ type: 'workspace.choose' }),
  openWorkspace: () => invoke({ type: 'workspace.open' }),
  exportDocs: () => invoke({ type: 'docs.export' }),
  repositoryGraph: () => invoke({ type: 'repository.graph' }),
  listModels: kind => invoke({ type: 'models.list', kind }),
  askQuestion: question => invoke({ type: 'chat.ask', question }),
  cancelQuestion: () => invoke({ type: 'chat.cancel' }),
  clearChat: () => invoke({ type: 'chat.clear' }),
  chatCitation: (id, section, claim, citation) => invoke({ type: 'chat.citation', id, section, claim, citation }),
  configureDocs: settings => invoke({ type: 'docs.configure', settings }),
  generateDocs: () => invoke({ type: 'docs.generate' }),
  cancelDocs: () => invoke({ type: 'docs.cancel' }),
  docCatalog: () => invoke({ type: 'docs.catalog' }),
  docPage: id => invoke({ type: 'docs.page', id }),
  docCitation: (id, section, claim, citation) => invoke({ type: 'docs.citation', id, section, claim, citation }),
  status: () => invoke({ type: 'status' }),
  restartWorker: () => invoke({ type: 'worker.restart' }),
  stopWorker: () => invoke({ type: 'worker.stop' }),
  connectLocal: branch => invoke({ type: 'repository.local', branch }),
  cloneRepository: (url, branch) => invoke({ type: 'repository.clone', url, branch }),
  syncRepository: () => invoke({ type: 'repository.sync' }),
  cancelSync: () => invoke({ type: 'repository.cancel' }),
  setAutoSync: enabled => invoke({ type: 'repository.auto', enabled }),
  disconnectRepository: () => invoke({ type: 'repository.disconnect' }),
  markNoticesRead: () => invoke({ type: 'notices.read' }),
  onStatus: listener => {
    const handle = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = desktopStatusSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on('desktop:status', handle);
    return () => ipcRenderer.removeListener('desktop:status', handle);
  },
};
contextBridge.exposeInMainWorld('desktop', bridge);
