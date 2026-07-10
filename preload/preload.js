'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  onState(callback) {
    const handler = (_event, payload) => {
      if (payload && typeof payload === 'object' && payload.state != null) {
        callback(String(payload.state), { sticky: !!payload.sticky });
      } else {
        callback(payload, {});
      }
    };
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
  },
  onStateControl(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('pet:state-control', handler);
    return () => ipcRenderer.removeListener('pet:state-control', handler);
  },
  onPrefs(callback) {
    const handler = (_event, prefs) => callback(prefs);
    ipcRenderer.on('pet:prefs', handler);
    return () => ipcRenderer.removeListener('pet:prefs', handler);
  },
  getTheme() {
    return ipcRenderer.invoke('pet:get-theme');
  },
  getPrefs() {
    return ipcRenderer.invoke('pet:get-prefs');
  },
  /**
   * @param {'fluid' | 'static'} [mode]
   */
  getAnimations(mode) {
    return ipcRenderer.invoke('pet:get-animations', mode || 'fluid');
  },
  getPushHistory() {
    return ipcRenderer.invoke('pet:get-push-history');
  },
  assetBase() {
    return ipcRenderer.invoke('pet:asset-base');
  },
  setIgnoreMouse(ignore) {
    ipcRenderer.send('pet:set-ignore', !!ignore);
  },
  dragStart(screenX, screenY) {
    ipcRenderer.send('pet:drag-start', { screenX, screenY });
  },
  dragMove(screenX, screenY) {
    ipcRenderer.send('pet:drag-move', { screenX, screenY });
  },
  dragEnd() {
    ipcRenderer.send('pet:drag-end');
  },
  wakeFromIdle() {
    ipcRenderer.send('pet:wake-from-idle');
  },
  showContextMenu() {
    ipcRenderer.send('pet:context-menu');
  },
  focusGrokTerminal() {
    return ipcRenderer.invoke('pet:focus-grok-terminal');
  },
  onThemeChanged(callback) {
    const handler = (_event, theme) => callback(theme);
    ipcRenderer.on('pet:theme-changed', handler);
    return () => ipcRenderer.removeListener('pet:theme-changed', handler);
  },
});
