'use strict';

const { contextBridge, ipcRenderer } = require('electron');
let beforeCloseCallback;

ipcRenderer.on('app:before-close', async () => {
  let saved = false;
  try {
    if (typeof beforeCloseCallback === 'function') saved = (await beforeCloseCallback()) === true;
  } catch { saved = false; }
  ipcRenderer.send('app:close-ready', saved);
});

contextBridge.exposeInMainWorld('desktopBridge', Object.freeze({
  saveProject: (project) => ipcRenderer.invoke('detail:save-project', project),
  loadProject: () => ipcRenderer.invoke('detail:load-project'),
  listProjects: () => ipcRenderer.invoke('detail:list-projects'),
  loadLibraryProject: (id) => ipcRenderer.invoke('detail:load-library-project', id),
  exportProject: (payload) => ipcRenderer.invoke('detail:export-project', payload),
  importProject: () => ipcRenderer.invoke('detail:import-project'),
  exportJpgs: (payload) => ipcRenderer.invoke('detail:export-jpgs', payload),
  saveApiConfig: (config) => ipcRenderer.invoke('detail:save-api-config', config),
  loadApiConfig: () => ipcRenderer.invoke('detail:load-api-config'),
  recognizeSize: (payload) => ipcRenderer.invoke('detail:recognize-size', payload),
  analyzeMaterials: (payload) => ipcRenderer.invoke('detail:analyze-materials', payload),
  getAppInfo: () => ipcRenderer.invoke('detail:app-info'),
  onBeforeClose: (callback) => { if (typeof callback === 'function') beforeCloseCallback = callback; },
}));
