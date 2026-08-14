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
const APP_USER_MODEL_ID = 'com.petgrok.app';

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
 * Preferred always-on-top attempts: [level, relativeLevel].
 * Higher levels + relativeLevel keep the pet above browsers (Edge/Chrome)
 * that otherwise win z-order among normal floating windows.
 * @returns {Array<[string, number]>}
 */
function alwaysOnTopAttempts() {
  // relativeLevel is macOS-only in practice; other OSes ignore it safely.
  if (isWin) {
    return [
      ['screen-saver', 1],
      ['pop-up-menu', 1],
      ['floating', 1],
      ['normal', 0],
    ];
  }
  if (isMac) {
    return [
      ['screen-saver', 1],
      ['status', 1],
      ['pop-up-menu', 1],
      ['floating', 1],
      ['normal', 0],
    ];
  }
  return [
    ['screen-saver', 1],
    ['floating', 1],
    ['normal', 0],
  ];
}

/**
 * Always-on-top levels differ by OS; try preferred order until one applies.
 * @param {import('electron').BrowserWindow} win
 * @returns {string | null} Applied level name, or null
 */
function setAlwaysOnTopSafe(win) {
  if (!win || win.isDestroyed()) return null;
  for (const [level, relativeLevel] of alwaysOnTopAttempts()) {
    try {
      win.setAlwaysOnTop(true, level, relativeLevel);
      return level;
    } catch {
      try {
        win.setAlwaysOnTop(true, level);
        return level;
      } catch {
        /* try next */
      }
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
 * skipTransformProcessType avoids dock/process-type thrash on reassert.
 * @param {import('electron').BrowserWindow} win
 */
function setVisibleOnAllWorkspacesSafe(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  } catch {
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
}

/**
 * Pin the pet above other app windows (including Edge/Chrome).
 *
 * Order matters on macOS: setVisibleOnAllWorkspaces can demote window level,
 * so always-on-top must be applied *after* it. moveTop re-raises without focus.
 *
 * Periodic keep-alive should pass `{ skipWorkspaces: true }`. Re-running VOAW
 * after hide/showInactive can leave the window on the desktop wallpaper layer
 * (stuck behind every app) if always-on-top does not take on the same tick.
 *
 * @param {import('electron').BrowserWindow} win
 * @param {{ skipWorkspaces?: boolean }} [opts]
 * @returns {string | null} Applied always-on-top level
 */
function applyOverlayZOrder(win, opts = {}) {
  if (!win || win.isDestroyed()) return null;
  if (!opts.skipWorkspaces) {
    setVisibleOnAllWorkspacesSafe(win);
  }
  const level = setAlwaysOnTopSafe(win);
  try {
    if (typeof win.moveTop === 'function') win.moveTop();
  } catch {
    /* ignore */
  }
  return level;
}

/**
 * Re-arm click-through after hide/show or display sleep.
 * macOS often drops `{ forward: true }` so the transparent bounds become a
 * dead rectangle stuck on the desktop.
 *
 * @param {import('electron').BrowserWindow} win
 * @returns {boolean}
 */
function resetOverlayClickThrough(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    win.setIgnoreMouseEvents(false);
    win.setIgnoreMouseEvents(true, { forward: true });
    return true;
  } catch {
    try {
      win.setIgnoreMouseEvents(true, { forward: true });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Pull a transparent overlay off the desktop wallpaper layer.
 *
 * After hide() + showInactive(), setVisibleOnAllWorkspaces(true) can leave
 * the window at desktop window level. Always-on-top then fails, and the pet
 * is stuck on the desktop (visible, not interactive, behind every app).
 * Leave the desktop space first, pin AOT, then rejoin Spaces.
 *
 * @param {import('electron').BrowserWindow} win
 * @returns {boolean}
 */
function unstickOverlayFromDesktop(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    win.setVisibleOnAllWorkspaces(false);
  } catch {
    /* ignore */
  }
  setAlwaysOnTopSafe(win);
  setVisibleOnAllWorkspacesSafe(win);
  setAlwaysOnTopSafe(win);
  try {
    if (typeof win.moveTop === 'function') win.moveTop();
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * Conceal without BrowserWindow.hide().
 * hide() is what makes the next show stick to the desktop on macOS.
 *
 * @param {import('electron').BrowserWindow} win
 * @returns {boolean}
 */
function concealOverlayWindow(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    // No forward: do not keep a hidden hit-target; pass everything through.
    win.setIgnoreMouseEvents(true);
  } catch {
    try {
      win.setIgnoreMouseEvents(true, { forward: true });
    } catch {
      /* ignore */
    }
  }
  try {
    win.setOpacity(0);
  } catch {
    return false;
  }
  return true;
}

/**
 * Reverse concealOverlayWindow. Does not call hide() or VOAW-first pin.
 *
 * @param {import('electron').BrowserWindow} win
 * @param {{ focus?: boolean }} [opts]
 * @returns {boolean}
 */
function revealOverlayWindow(win, opts = {}) {
  if (!win || win.isDestroyed()) return false;
  try {
    win.setOpacity(1);
  } catch {
    /* ignore */
  }
  try {
    if (opts.focus && typeof win.show === 'function') win.show();
    else if (typeof win.isVisible === 'function' && !win.isVisible()) {
      if (typeof win.show === 'function') win.show();
    }
  } catch {
    try {
      if (typeof win.showInactive === 'function') win.showInactive();
    } catch {
      return false;
    }
  }
  resetOverlayClickThrough(win);
  unstickOverlayFromDesktop(win);
  return true;
}

/**
 * True when the overlay is hide()'d (broken path) rather than opacity-concealed.
 * @param {import('electron').BrowserWindow | null} win
 * @returns {boolean}
 */
function overlayNeedsRebuild(win) {
  if (!win || win.isDestroyed()) return true;
  try {
    return typeof win.isVisible === 'function' && !win.isVisible();
  } catch {
    return true;
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
  if (isMac) {
    // NSPanel survives hide/show without dropping to the desktop wallpaper level.
    return {
      type: 'panel',
      hiddenInMissionControl: true,
      acceptFirstMouse: true,
    };
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
    return 'Quit other Pet Grok / Electron instances, then double-click "OPEN ON WINDOWS - Open Pet Grok.lnk" or run npm start in the app folder again.';
  }
  if (isMac) {
    return 'Quit other Pet Grok / Electron instances, then double-click "OPEN ON MAC - Open Pet Grok.command" or run npm start in the app folder again.';
  }
  return 'Quit other Pet Grok / Electron instances, then run npm start in the app folder again.';
}

module.exports = {
  isWin,
  isMac,
  isLinux,
  APP_USER_MODEL_ID,
  configureAppChrome,
  alwaysOnTopAttempts,
  setAlwaysOnTopSafe,
  setVisibleOnAllWorkspacesSafe,
  applyOverlayZOrder,
  resetOverlayClickThrough,
  unstickOverlayFromDesktop,
  concealOverlayWindow,
  revealOverlayWindow,
  overlayNeedsRebuild,
  windowPlatformOptions,
  trayIconCandidates,
  trayIconSize,
  trayOpensOnClick,
  pathToAssetUrl,
  restartHint,
};
