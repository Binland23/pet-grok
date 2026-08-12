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
  /**
   * Manually set the pet state (locks into manual mode until Auto is selected).
   * States: idle / wake / thinking / working / done / alert / sleep / click (WEEEE).
   * @param {string} state
   */
  setState(state) {
    return ipcRenderer.invoke('dashboard:set-state', state);
  },
  /**
   * 'auto' = Grok hooks drive the pet; 'manual' = keep the forced pose.
   * @param {'auto' | 'manual'} mode
   */
  setStateMode(mode) {
    return ipcRenderer.invoke('dashboard:set-state-mode', mode);
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
