const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  chooseFolder: () => ipcRenderer.invoke('workspace:choose'),
  list: request => ipcRenderer.invoke('workspace:list', request),
  read: request => ipcRenderer.invoke('workspace:read', request),
  save: request => ipcRenderer.invoke('workspace:save', request),
  create: request => ipcRenderer.invoke('workspace:create', request),
  setDirty: dirty => ipcRenderer.send('workspace:dirty', dirty === true),
});
