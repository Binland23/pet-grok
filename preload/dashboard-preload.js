'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  getSnapshot() {
    return ipcRenderer.invoke('dashboard:get-snapshot');
  },
  applySettings(patch) {
    return ipcRenderer.invoke('dashboard:apply-settings', patch);
  },
  setTheme(themeId) {
    return ipcRenderer.invoke('dashboard:set-theme', themeId);
  },
  installHooks() {
    return ipcRenderer.invoke('dashboard:install-hooks');
  },
  uninstallHooks() {
    return ipcRenderer.invoke('dashboard:uninstall-hooks');
  },
  openHealth() {
    return ipcRenderer.invoke('dashboard:open-health');
  },
  onSnapshot(callback) {
    const handler = (_e, snap) => callback(snap);
    ipcRenderer.on('dashboard:snapshot', handler);
    return () => ipcRenderer.removeListener('dashboard:snapshot', handler);
  },
  close() {
    ipcRenderer.send('dashboard:close');
  },
});
