'use strict';

/**
 * OS boundary helpers for Pet Grok.
 * Shared core stays platform-agnostic; only chrome/tray/paths branch here.
 */

const { pathToFileURL } = require('url');
const path = require('path');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

/** App id for Windows taskbar / toast grouping */
const APP_USER_MODEL_ID = 'com.binland23.petgrok';

/**
 * Configure process-level app chrome once Electron is ready.
 * @param {import('electron').App} app
 */
function configureAppChrome(app) {
  if (isWin && typeof app.setAppUserModelId === 'function') {
    try {
      app.setAppUserModelId(APP_USER_MODEL_ID);
    } catch {
      /* ignore */
    }
  }
  if (isMac && app.dock) {
    try {
      app.dock.hide();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Always-on-top levels differ by OS; try preferred order until one applies.
 * @param {import('electron').BrowserWindow} win
 */
function setAlwaysOnTopSafe(win) {
  if (!win || win.isDestroyed()) return;
  const levels = isWin
    ? ['screen-saver', 'pop-up-menu', 'floating', 'normal']
    : ['screen-saver', 'floating', 'normal'];
  for (const level of levels) {
    try {
      win.setAlwaysOnTop(true, level);
      return level;
    } catch {
      /* try next */
    }
  }
  try {
    win.setAlwaysOnTop(true);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Visible on all Spaces / virtual desktops (best-effort; stronger on macOS).
 * @param {import('electron').BrowserWindow} win
 */
function setVisibleOnAllWorkspacesSafe(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    try {
      win.setVisibleOnAllWorkspaces(true);
    } catch {
      /* Windows / older Electron may no-op */
    }
  }
}

/**
 * Extra BrowserWindow options that differ by OS.
 * @returns {Record<string, unknown>}
 */
function windowPlatformOptions() {
  if (isWin) {
    // Avoid thick frame edge artifacts on transparent frameless windows
    return { thickFrame: false };
  }
  return {};
}

/**
 * Tray icon candidate filenames in preferred order.
 * @returns {string[]}
 */
function trayIconCandidates() {
  if (isWin) {
    return ['tray.ico', 'tray-32.png', 'tray-16.png', 'tray-256.png'];
  }
  return ['tray-32.png', 'tray-16.png', 'tray-64.png', 'tray-256.png', 'tray.ico'];
}

/** Preferred tray bitmap edge length (px). */
function trayIconSize() {
  return isMac ? 22 : 16;
}

/**
 * Left-click tray: open menu on Windows/Linux; macOS uses right-click only.
 * @returns {boolean}
 */
function trayOpensOnClick() {
  return !isMac;
}

/**
 * Safe file:// URL for renderer asset loads (handles Win drive letters, spaces).
 * @param {string} absPath
 * @returns {string}
 */
function pathToAssetUrl(absPath) {
  return pathToFileURL(path.resolve(absPath)).href;
}

/**
 * Human-readable restart hint for error dialogs (platform-neutral).
 * @returns {string}
 */
function restartHint() {
  if (isWin) {
    return 'Quit other Pet Grok / Electron instances, then run RUN ME.bat or npm start again.';
  }
  if (isMac) {
    return 'Quit other Pet Grok / Electron instances, then double-click RUN ME.command or run npm start again.';
  }
  return 'Quit other Pet Grok / Electron instances, then run npm start again.';
}

module.exports = {
  isWin,
  isMac,
  isLinux,
  APP_USER_MODEL_ID,
  configureAppChrome,
  setAlwaysOnTopSafe,
  setVisibleOnAllWorkspacesSafe,
  windowPlatformOptions,
  trayIconCandidates,
  trayIconSize,
  trayOpensOnClick,
  pathToAssetUrl,
  restartHint,
};
