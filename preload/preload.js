'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  onState(callback) {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
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
  getAnimations() {
    return ipcRenderer.invoke('pet:get-animations');
  },
  getPushHistory() {
    return ipcRenderer.invoke('pet:get-push-history');
  },
  assetPath(rel) {
    return ipcRenderer.invoke('pet:asset-path', rel);
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
