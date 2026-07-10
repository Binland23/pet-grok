'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  screen,
} = require('electron');

const prefs = require('./prefs');
const hooks = require('./hooks');
const { startStateServer, ALLOWED_STATES, STATE_ALIASES } = require('./state-server');
const platform = require('./platform');
const themes = require('./themes');
const { focusActiveGrokTerminal } = require('./focus-terminal');
const { createBoundedLogger } = require('./bounded-log');
const { debounce } = require('./debounce');

const IDLE_TIMEOUT_MS = 60_000;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let dashboardWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {ReturnType<typeof startStateServer> | null} */
let stateServer = null;
/** @type {NodeJS.Timeout | null} */
let idleTimer = null;
let suppressMovedSave = false;
/** @type {ReturnType<typeof prefs.load> | null} */
let state = null;
/** @type {string} */
let lastKnownState = 'idle';
/**
 * Dashboard state control:
 * - auto: Grok hooks + idle timeout drive the pet (default)
 * - manual: user-forced pose; hooks ignored until Auto is selected again
 * @type {'auto' | 'manual'}
 */
let stateControlMode = 'auto';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openDashboard();
    if (mainWindow && getState().visible !== false) {
      if (!mainWindow.isVisible()) mainWindow.show();
    }
  });
}

function getState() {
  if (!state) {
    state = prefs.load();
    state.themeId = themes.normalizeThemeId(state.themeId);
    if (
      state.trayIconId !== 'grok' &&
      state.trayIconId !== 'match-pet' &&
      themes.normalizeThemeId(state.trayIconId, '') === ''
    ) {
      state.trayIconId = 'grok';
    }
  }
  return state;
}

function loadTheme(themeId) {
  const s = getState();
  const id = themeId || s.themeId || 'race-crab';
  const fromDisk = themes.loadThemeJson(id);
  if (fromDisk) return fromDisk;
  return {
    id: 'race-crab',
    name: 'Hermit Crab',
    celebrateMs: 2500,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  };
}

/** Active agent states must NEVER auto-sleep (long model responses have no hooks). */
const ACTIVE_AGENT_STATES = new Set(['thinking', 'working', 'alert', 'wake']);

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function resetIdleTimer() {
  clearIdleTimer();
  if (stateControlMode === 'manual') return;
  const ms = loadTheme().idleTimeoutMs || IDLE_TIMEOUT_MS;
  idleTimer = setTimeout(() => {
    pushState('sleep');
  }, ms);
}

/**
 * Normalize a state name (aliases like weee → click).
 * @param {unknown} state
 * @returns {string}
 */
function normalizePetState(state) {
  let s = String(state || '')
    .trim()
    .toLowerCase();
  if (STATE_ALIASES[s]) s = STATE_ALIASES[s];
  return s;
}

/**
 * Resume hook-driven behavior after a manual lock.
 */
function setStateControlAuto() {
  stateControlMode = 'auto';
  // Drop sticky hold on one-shot poses so normal transitions resume
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('pet:state-control', { mode: 'auto' });
    } catch {
      /* ignore */
    }
  }
  // Re-arm idle policy from whatever pose the pet is currently in
  if (ACTIVE_AGENT_STATES.has(lastKnownState)) {
    clearIdleTimer();
  } else if (lastKnownState === 'idle') {
    resetIdleTimer();
  } else if (lastKnownState === 'sleep' || lastKnownState === 'done' || lastKnownState === 'click') {
    clearIdleTimer();
  } else {
    clearIdleTimer();
  }
  broadcastDashboardSnapshot();
}

/** Last states pushed to renderer (for health / debugging). */
const pushHistory = [];

function pushStateLogPath() {
  try {
    return path.join(app.getPath('userData'), 'push-state.log');
  } catch {
    return path.join(os.homedir(), '.grok', 'pet-push-state.log');
  }
}

const saveMovedPosition = debounce(() => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow._dragOffset) return;
  const [nx, ny] = mainWindow.getPosition();
  const st = getState();
  st.x = nx;
  st.y = ny;
  prefs.save(st);
}, 500);

const pushLogger = createBoundedLogger({
  enabled: /^(1|true|yes)$/i.test(String(process.env.PET_GROK_DEBUG_LOGS || '')),
  filePath: pushStateLogPath,
});

function appendPushLog(line) {
  void pushLogger.append(line);
}

/**
 * Surface the pet overlay if this process is running.
 * Used on Grok SessionStart (wake): even if the user hid the pet earlier,
 * starting a Grok session brings it back. Does not launch a new process.
 * @param {string} [reason]
 */
function forceShowPet(reason) {
  const s = getState();
  let prefsChanged = false;
  if (s.visible === false) {
    s.visible = true;
    prefs.save(s);
    prefsChanged = true;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.showInactive();
    }
  }
  appendPushLog(`[forceShow] ${reason || 'show'} visible=true prefsChanged=${prefsChanged}`);
  if (prefsChanged) {
    rebuildTray();
    broadcastDashboardSnapshot();
  }
}

/**
 * Push a pet state to the overlay.
 * @param {string} petState
 * @param {{ manual?: boolean, sticky?: boolean }} [opts]
 *   manual: dashboard force (allowed while stateControlMode is manual)
 *   sticky: hold one-shot poses (wake/done/click) instead of auto-returning to idle
 */
function pushState(petState, opts = {}) {
  petState = normalizePetState(petState);
  // While the user has locked a manual pose, ignore Grok hooks / idle auto-sleep.
  if (stateControlMode === 'manual' && !opts.manual) {
    appendPushLog(`[pushState] ignored (manual mode): ${petState}`);
    return;
  }

  const sticky = stateControlMode === 'manual' || !!opts.sticky;
  const at = Date.now();
  lastKnownState = petState;
  const hasWindow = !!(mainWindow && !mainWindow.isDestroyed());
  pushHistory.push({ state: petState, at, window: hasWindow, sticky });
  if (pushHistory.length > 40) pushHistory.shift();
  const line = `[pushState] ${petState} sticky=${sticky} manual=${!!opts.manual} window=${hasWindow} at=${at}`;
  console.log(line);
  appendPushLog(line);
  broadcastDashboardSnapshot();

  if (hasWindow) {
    const payload = sticky ? { state: petState, sticky: true } : petState;
    const send = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pet:state', payload);
        appendPushLog(`[pushState] IPC sent pet:state=${petState} sticky=${sticky} at=${Date.now()}`);
      }
    };
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', send);
    } else {
      send();
    }
    // SessionStart → wake: always unhide if the pet app is already running
    if (petState === 'wake') {
      forceShowPet('session-start-wake');
    } else if (petState !== 'sleep' && !mainWindow.isVisible() && getState().visible !== false) {
      // Other active states: only re-show if not intentionally hidden
      mainWindow.showInactive();
    }
  }

  // Idle timeout policy (disabled entirely while manual lock is on):
  // - thinking/working/alert: agent mid-turn → never auto-sleep
  // - idle: start 60s quiet timer
  // - done/wake: brief; timer starts when we reach idle
  // - sleep: clear timer
  if (stateControlMode === 'manual') {
    clearIdleTimer();
    return;
  }
  if (ACTIVE_AGENT_STATES.has(petState)) {
    clearIdleTimer();
  } else if (petState === 'idle') {
    resetIdleTimer();
  } else if (petState === 'sleep') {
    clearIdleTimer();
  } else if (petState === 'done' || petState === 'click') {
    clearIdleTimer();
  }
}

function windowSize() {
  return prefs.sizePx(getState().size);
}

function createWindow() {
  const s = getState();
  const size = windowSize();
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const { x: ox, y: oy } = display.workArea;

  let x = s.x;
  let y = s.y;
  if (x == null || y == null) {
    x = ox + sw - size - 24;
    y = oy + sh - size - 48;
  }

  mainWindow = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    ...platform.windowPlatformOptions(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  platform.setAlwaysOnTopSafe(mainWindow);
  platform.setVisibleOnAllWorkspacesSafe(mainWindow);

  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (getState().visible !== false) {
      mainWindow.showInactive();
    }
  });

  mainWindow.on('moved', () => {
    if (!mainWindow || mainWindow._dragOffset || suppressMovedSave) return;
    saveMovedPosition();
  });

  mainWindow.on('closed', () => {
    saveMovedPosition.cancel();
    suppressMovedSave = false;
    mainWindow = null;
  });
}

const TRAY_ICON_GROK = 'grok';
const TRAY_ICON_MATCH_PET = 'match-pet';

/** @returns {string} Resolved theme id or 'grok' for the tray bitmap */
function resolveTrayIconId() {
  const s = getState();
  const raw = String(s.trayIconId || TRAY_ICON_GROK).trim() || TRAY_ICON_GROK;
  if (raw === TRAY_ICON_MATCH_PET) {
    return s.themeId || 'race-crab';
  }
  return raw;
}

/**
 * Resize a nativeImage for the menu bar / notification tray.
 * @param {Electron.NativeImage} img
 * @param {{ template?: boolean }} [opts]
 */
function fitTrayImage(img, opts = {}) {
  if (!img || img.isEmpty()) return img;
  const size = platform.trayIconSize();
  let out = img;
  if (out.getSize().width !== size || out.getSize().height !== size) {
    out = out.resize({ width: size, height: size, quality: 'best' });
  }
  // Monochrome Grok mark → template on macOS (adapts to menu bar theme)
  if (opts.template && platform.isMac) {
    out.setTemplateImage(true);
  }
  return out;
}

function loadGrokTrayImage() {
  const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
  const candidates = platform.trayIconCandidates();
  for (const name of candidates) {
    const p = path.join(iconsDir, name);
    if (!fs.existsSync(p)) continue;
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) continue;
    return fitTrayImage(img, { template: true });
  }
  return null;
}

/** Pet idle sprite as a color tray icon (transparent background). */
function loadPetTrayImage(themeId) {
  const id = themeId || 'race-crab';
  const list = themes.listThemes();
  const match = list.find((t) => t.id === id);
  const previewPath =
    (match && match.preview) ||
    path.join(__dirname, '..', 'themes', id, 'sprites', 'idle.png');
  if (!previewPath || !fs.existsSync(previewPath)) return null;
  const img = nativeImage.createFromPath(previewPath);
  if (img.isEmpty()) return null;
  return fitTrayImage(img, { template: false });
}

/**
 * Tray icon from prefs: Grok logo (default), match active pet, or a fixed pet.
 * Icons use transparent backgrounds (no circular plate).
 */
function createTrayImage() {
  const resolved = resolveTrayIconId();
  let img = null;
  if (resolved === TRAY_ICON_GROK) {
    img = loadGrokTrayImage();
  } else {
    img = loadPetTrayImage(resolved) || loadGrokTrayImage();
  }
  if (img && !img.isEmpty()) return img;
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  );
}

function updateTrayImage() {
  if (!tray) return;
  try {
    tray.setImage(createTrayImage());
  } catch (err) {
    console.warn('[tray] setImage failed', err && err.message);
  }
}

/** Options for dashboard / tray menu pickers */
function listTrayIconOptions() {
  const grokPreview = path.join(__dirname, '..', 'assets', 'icons', 'tray-64.png');
  /** @type {{ id: string, name: string, description: string, previewUrl: string|null, kind: string }[]} */
  const options = [
    {
      id: TRAY_ICON_GROK,
      name: 'Grok logo',
      description: 'xAI mark · transparent',
      previewUrl: fs.existsSync(grokPreview) ? platform.pathToAssetUrl(grokPreview) : null,
      kind: 'grok',
    },
    {
      id: TRAY_ICON_MATCH_PET,
      name: 'Match pet',
      description: 'Follows the active pet',
      previewUrl: null,
      kind: 'match',
    },
  ];
  const installedThemes = themes.listThemes();
  for (const t of installedThemes) {
    options.push({
      id: t.id,
      name: t.name || t.id,
      description: 'Pet idle pose',
      previewUrl: t.preview ? platform.pathToAssetUrl(t.preview) : null,
      kind: 'pet',
    });
  }
  const matchOpt = options.find((o) => o.id === TRAY_ICON_MATCH_PET);
  if (matchOpt) {
    const current = installedThemes.find((t) => t.id === (getState().themeId || 'race-crab'));
    if (current && current.preview) {
      matchOpt.previewUrl = platform.pathToAssetUrl(current.preview);
    }
  }
  return options;
}

function isValidTrayIconId(id) {
  const raw = String(id || '').trim();
  if (!raw) return false;
  if (raw === TRAY_ICON_GROK || raw === TRAY_ICON_MATCH_PET) return true;
  return themes.listThemes().some((t) => t.id === raw);
}

/** Shared menu for tray + right-click on the pet */
function buildAppMenu() {
  const s = getState();
  const installed = hooks.isInstalled();
  const theme = loadTheme(s.themeId);
  return Menu.buildFromTemplate([
    {
      label: theme.name || 'Pet Grok',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Dashboard…',
      accelerator: platform.isMac ? 'Cmd+,' : 'Ctrl+,',
      click: () => openDashboard(),
    },
    { type: 'separator' },
    {
      label: s.visible === false ? 'Show Pet' : 'Hide Pet',
      click: () => {
        applySettingsPatch({ visible: s.visible === false });
      },
    },
    { type: 'separator' },
    {
      label: 'Pet',
      submenu: themes.listThemes().map((t) => ({
        label: t.name || t.id,
        type: 'radio',
        checked: (s.themeId || 'race-crab') === t.id,
        click: () => applySettingsPatch({ themeId: t.id }),
      })),
    },
    {
      label: 'Tray icon',
      submenu: listTrayIconOptions().map((opt) => ({
        label: opt.name,
        type: 'radio',
        checked: (s.trayIconId || TRAY_ICON_GROK) === opt.id,
        click: () => applySettingsPatch({ trayIconId: opt.id }),
      })),
    },
    {
      label: 'Size',
      submenu: ['S', 'M', 'L'].map((key) => ({
        label: key === 'S' ? 'Small' : key === 'M' ? 'Medium' : 'Large',
        type: 'radio',
        checked: s.size === key,
        click: () => applySize(key),
      })),
    },
    {
      label: 'Mute sounds',
      type: 'checkbox',
      checked: !!s.mute,
      click: (item) => {
        applySettingsPatch({ mute: item.checked });
      },
    },
    { type: 'separator' },
    {
      label: installed ? 'Uninstall Grok Hooks' : 'Install Grok Hooks',
      click: () => {
        const st = getState();
        if (hooks.isInstalled()) {
          hooks.uninstallHooks();
          st.hooksUserDisabled = true;
          st.hooksAutoInstalled = false;
          console.log('[hooks] uninstalled', hooks.getHookFilePath());
        } else {
          const p = hooks.installHooks();
          st.hooksUserDisabled = false;
          st.hooksAutoInstalled = true;
          console.log('[hooks] installed', p);
        }
        prefs.save(st);
        rebuildTray();
        broadcastDashboardSnapshot();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Pet Grok',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function rebuildTray() {
  if (!tray) return;
  updateTrayImage();
  tray.setContextMenu(buildAppMenu());
  const theme = loadTheme(getState().themeId);
  const trayId = getState().trayIconId || TRAY_ICON_GROK;
  const trayLabel =
    trayId === TRAY_ICON_GROK
      ? 'Grok logo'
      : trayId === TRAY_ICON_MATCH_PET
        ? `Match pet (${theme.name || 'pet'})`
        : loadTheme(trayId).name || trayId;
  tray.setToolTip(`Pet Grok — ${theme.name || 'Desktop pet'} · tray: ${trayLabel}`);
}

/**
 * Build a serializable dashboard snapshot for the settings UI.
 */
function buildDashboardSnapshot() {
  const s = getState();
  const theme = loadTheme(s.themeId);
  const themeList = themes.listThemes().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    previewUrl: t.preview ? platform.pathToAssetUrl(t.preview) : null,
  }));
  let serverOk = false;
  let lastState = lastKnownState;
  if (stateServer) {
    serverOk = true;
    try {
      lastState = stateServer.getLastState() || lastKnownState;
    } catch {
      /* ignore */
    }
  }
  return {
    size: s.size || 'M',
    mute: !!s.mute,
    animationMode: prefs.normalizeAnimationMode(s.animationMode),
    visible: s.visible !== false,
    themeId: s.themeId || 'race-crab',
    themeName: theme.name || s.themeId || 'Pet',
    trayIconId: s.trayIconId || TRAY_ICON_GROK,
    trayIcons: listTrayIconOptions(),
    themes: themeList,
    hooksInstalled: hooks.isInstalled(),
    hooksPath: hooks.getHookFilePath(),
    serverOk,
    lastState: lastKnownState || lastState,
    stateControlMode,
    history: pushHistory.slice(-12),
    version: app.getVersion() || '1.0.0',
  };
}

function broadcastDashboardSnapshot() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
  try {
    dashboardWindow.webContents.send('dashboard:snapshot', buildDashboardSnapshot());
  } catch {
    /* ignore */
  }
}

/**
 * Apply a prefs patch from menu or dashboard; updates pet + tray + dashboard.
 * @param {Record<string, unknown>} patch
 */
function applySettingsPatch(patch) {
  const s = getState();
  if (patch.size != null && ['S', 'M', 'L'].includes(String(patch.size))) {
    s.size = String(patch.size);
  }
  if (typeof patch.mute === 'boolean') s.mute = patch.mute;
  if (patch.animationMode != null) {
    s.animationMode = prefs.normalizeAnimationMode(patch.animationMode);
  }
  if (typeof patch.visible === 'boolean') s.visible = patch.visible;
  if (patch.themeId != null && String(patch.themeId).trim()) {
    // Only accept installed theme ids (blocks path traversal via themeId)
    s.themeId = themes.normalizeThemeId(String(patch.themeId).trim());
  }
  if (patch.trayIconId != null && isValidTrayIconId(patch.trayIconId)) {
    s.trayIconId = String(patch.trayIconId).trim();
  }
  prefs.save(s);

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (patch.size != null) {
      const size = prefs.sizePx(s.size);
      const [x, y] = mainWindow.getPosition();
      mainWindow.setBounds({ x, y, width: size, height: size });
    }
    if (typeof patch.visible === 'boolean') {
      if (s.visible === false) mainWindow.hide();
      else mainWindow.showInactive();
    }
    mainWindow.webContents.send('pet:prefs', {
      mute: s.mute,
      size: s.size,
      themeId: s.themeId,
      animationMode: prefs.normalizeAnimationMode(s.animationMode),
      trayIconId: s.trayIconId,
    });
    if (patch.themeId != null) {
      mainWindow.webContents.send('pet:theme-changed', loadTheme(s.themeId));
    }
  }

  rebuildTray();
  broadcastDashboardSnapshot();
  return buildDashboardSnapshot();
}

function openDashboard() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    broadcastDashboardSnapshot();
    return dashboardWindow;
  }

  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const { x: ox, y: oy } = display.workArea;
  const width = 780;
  const height = 720;
  const x = Math.round(ox + (sw - width) / 2);
  const y = Math.round(oy + (sh - height) / 2);

  dashboardWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 640,
    minHeight: 520,
    show: false,
    title: 'Pet Grok — Dashboard',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'dashboard-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  dashboardWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  dashboardWindow.once('ready-to-show', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.show();
      dashboardWindow.focus();
      broadcastDashboardSnapshot();
    }
  });
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
  return dashboardWindow;
}

function popupPetMenu() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Ensure the overlay can receive the menu
  mainWindow.setIgnoreMouseEvents(false);
  const menu = buildAppMenu();
  menu.popup({
    window: mainWindow,
    callback: () => {
      // Restore click-through after menu closes; renderer will re-hit-test
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    },
  });
}

function applySize(key) {
  applySettingsPatch({ size: key });
}

function createTray() {
  tray = new Tray(createTrayImage());
  rebuildTray();
  tray.on('click', () => {
    if (!platform.trayOpensOnClick()) return;
    tray.popUpContextMenu();
  });
}

/**
 * Restrict IPC handlers to the expected BrowserWindow.
 * @param {Electron.IpcMainInvokeEvent | Electron.IpcMainEvent} event
 * @param {BrowserWindow | null} win
 */
function isSenderWindow(event, win) {
  if (!win || win.isDestroyed()) return false;
  try {
    return event.sender === win.webContents;
  } catch {
    return false;
  }
}

function registerIpc() {
  // —— Pet overlay (mainWindow only) ——
  ipcMain.handle('pet:get-theme', (e) => {
    if (!isSenderWindow(e, mainWindow)) return null;
    return loadTheme(getState().themeId);
  });
  ipcMain.handle('pet:get-prefs', (e) => {
    if (!isSenderWindow(e, mainWindow)) return null;
    const s = getState();
    return {
      mute: s.mute,
      size: s.size,
      themeId: s.themeId,
      animationMode: prefs.normalizeAnimationMode(s.animationMode),
      visible: s.visible !== false,
    };
  });
  ipcMain.handle('pet:get-push-history', (e) => {
    if (!isSenderWindow(e, mainWindow)) return [];
    return pushHistory.slice(-20);
  });
  ipcMain.handle('pet:get-animations', (e, mode) => {
    if (!isSenderWindow(e, mainWindow)) return null;
    const animMode = String(mode || 'fluid').toLowerCase() === 'static' ? 'static' : 'fluid';
    const p = themes.themeAnimationsPath(getState().themeId, animMode);
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) {
      console.error('[animations]', err.message);
      return null;
    }
  });
  ipcMain.handle('pet:asset-base', (e) => {
    if (!isSenderWindow(e, mainWindow)) return '';
    const abs = themes.themeAssetBase(getState().themeId);
    return platform.pathToAssetUrl(abs) + '/';
  });

  // —— Dashboard only ——
  ipcMain.handle('dashboard:get-snapshot', (e) => {
    if (!isSenderWindow(e, dashboardWindow)) return null;
    return buildDashboardSnapshot();
  });
  ipcMain.handle('dashboard:apply-settings', (e, patch) => {
    if (!isSenderWindow(e, dashboardWindow)) return null;
    return applySettingsPatch(patch && typeof patch === 'object' ? patch : {});
  });
  ipcMain.handle('dashboard:set-theme', (e, themeId) => {
    if (!isSenderWindow(e, dashboardWindow)) return null;
    return applySettingsPatch({ themeId: String(themeId || 'race-crab') });
  });
  ipcMain.handle('dashboard:install-hooks', (e) => {
    if (!isSenderWindow(e, dashboardWindow)) return null;
    const p = hooks.installHooks();
    console.log('[hooks] installed from dashboard', p);
    const s = getState();
    s.hooksUserDisabled = false;
    s.hooksAutoInstalled = true;
    prefs.save(s);
    rebuildTray();
    return buildDashboardSnapshot();
  });
  ipcMain.handle('dashboard:uninstall-hooks', (e) => {
    if (!isSenderWindow(e, dashboardWindow)) return null;
    hooks.uninstallHooks();
    console.log('[hooks] uninstalled from dashboard');
    const s = getState();
    s.hooksUserDisabled = true;
    s.hooksAutoInstalled = false;
    prefs.save(s);
    rebuildTray();
    return buildDashboardSnapshot();
  });
  ipcMain.handle('dashboard:open-health', async (e) => {
    if (!isSenderWindow(e, dashboardWindow)) return { ok: false, lastState: lastKnownState };
    if (!stateServer) return { ok: false, lastState: lastKnownState };
    return {
      ok: true,
      lastState: stateServer.getLastState(),
      history: stateServer.getHistory().slice(-12),
      pid: process.pid,
    };
  });
  /**
   * Manually force a pet state from the dashboard.
   * Enters manual mode: pose sticks (including wake/done/WEEEE) and hooks are ignored.
   * @param {Electron.IpcMainInvokeEvent} e
   * @param {unknown} state
   */
  ipcMain.handle('dashboard:set-state', (e, state) => {
    if (!isSenderWindow(e, dashboardWindow)) {
      return { ok: false, error: 'forbidden' };
    }
    const s = normalizePetState(state);
    if (!ALLOWED_STATES.has(s)) {
      return { ok: false, error: `unknown state: ${s}`, ...buildDashboardSnapshot() };
    }
    stateControlMode = 'manual';
    // Record on the HTTP server without re-entering pushState via onState
    if (stateServer && typeof stateServer.setState === 'function') {
      stateServer.setState(s, { emit: false });
    }
    pushState(s, { manual: true, sticky: true });
    return { ok: true, state: s, ...buildDashboardSnapshot() };
  });
  /**
   * Switch between auto (hooks) and manual (dashboard lock) state control.
   * @param {Electron.IpcMainInvokeEvent} e
   * @param {unknown} mode
   */
  ipcMain.handle('dashboard:set-state-mode', (e, mode) => {
    if (!isSenderWindow(e, dashboardWindow)) {
      return { ok: false, error: 'forbidden' };
    }
    const m = String(mode || '')
      .trim()
      .toLowerCase();
    if (m === 'auto') {
      setStateControlAuto();
      return { ok: true, stateControlMode: 'auto', ...buildDashboardSnapshot() };
    }
    if (m === 'manual') {
      stateControlMode = 'manual';
      clearIdleTimer();
      broadcastDashboardSnapshot();
      return { ok: true, stateControlMode: 'manual', ...buildDashboardSnapshot() };
    }
    return {
      ok: false,
      error: `unknown mode: ${m}`,
      ...buildDashboardSnapshot(),
    };
  });
  ipcMain.on('dashboard:close', (e) => {
    if (!isSenderWindow(e, dashboardWindow)) return;
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.close();
    }
  });

  ipcMain.on('pet:set-ignore', (e, ignore) => {
    if (!isSenderWindow(e, mainWindow)) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (ignore) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
  });

  /**
   * Drag uses main-process cursor + locked content size.
   * Repeated setPosition() on frameless/transparent windows (esp. Windows DPI)
   * can accumulate size growth; always re-apply width/height from prefs.
   */
  ipcMain.on('pet:drag-start', (e) => {
    if (!isSenderWindow(e, mainWindow)) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = mainWindow.getPosition();
    mainWindow._dragOffset = { x: cursor.x - wx, y: cursor.y - wy };
    mainWindow.setIgnoreMouseEvents(false);
    // Snap size back to the configured preset before moving
    const size = windowSize();
    mainWindow.setBounds({ x: wx, y: wy, width: size, height: size });
  });

  ipcMain.on('pet:drag-move', (e) => {
    if (!isSenderWindow(e, mainWindow)) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow._dragOffset) return;
    const cursor = screen.getCursorScreenPoint();
    const size = windowSize();
    const nx = Math.round(cursor.x - mainWindow._dragOffset.x);
    const ny = Math.round(cursor.y - mainWindow._dragOffset.y);
    mainWindow.setBounds({ x: nx, y: ny, width: size, height: size });
  });

  ipcMain.on('pet:drag-end', (e) => {
    if (!isSenderWindow(e, mainWindow)) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    saveMovedPosition.cancel();
    const size = windowSize();
    const [x, y] = mainWindow.getPosition();
    // Final clamp so any DPI drift is discarded
    suppressMovedSave = true;
    mainWindow.setBounds({ x, y, width: size, height: size });
    mainWindow._dragOffset = null;
    setTimeout(() => {
      suppressMovedSave = false;
    }, 100);
    const s = getState();
    s.x = x;
    s.y = y;
    prefs.save(s);
  });

  ipcMain.on('pet:wake-from-idle', (e) => {
    if (!isSenderWindow(e, mainWindow)) return;
    pushState('idle');
  });

  ipcMain.on('pet:context-menu', (e) => {
    if (!isSenderWindow(e, mainWindow)) return;
    popupPetMenu();
  });

  ipcMain.handle('pet:focus-grok-terminal', async (e) => {
    if (!isSenderWindow(e, mainWindow)) return { ok: false, reason: 'forbidden' };
    try {
      const result = await focusActiveGrokTerminal();
      console.log('[focus-grok-terminal]', result);
      return result;
    } catch (err) {
      console.error('[focus-grok-terminal]', err);
      return { ok: false, reason: err && err.message ? err.message : String(err) };
    }
  });
}

/**
 * Install/refresh hooks on launch unless the user explicitly uninstalled them.
 */
function ensureHooksOnLaunch() {
  const s = getState();
  if (s.hooksUserDisabled) {
    console.log('[hooks] skipped — user disabled (hooksUserDisabled)');
    return;
  }
  try {
    const p = hooks.installHooks();
    console.log('[hooks] installed/refreshed', p);
    s.hooksAutoInstalled = true;
    prefs.save(s);
  } catch (err) {
    console.error('[hooks] install failed', err);
  }
}

app.whenReady().then(async () => {
  state = prefs.load();
  platform.configureAppChrome(app);

  // Bind state server FIRST so hooks have a live target before window paints
  try {
    stateServer = await startStateServer(
      (petState) => {
        console.log('[state]', petState);
        pushState(petState);
      },
      {
        // POST /show — unhide if already running (used by tests / manual curl)
        onShow: () => forceShowPet('http-show'),
      }
    );
  } catch (err) {
    console.error(
      '[state-server] FAILED to bind 127.0.0.1:7788 — another Pet Grok may be running.',
      err.message
    );
    // Single-instance lock should prevent this; if port is stolen, fail loud.
    const { dialog } = require('electron');
    try {
      dialog.showErrorBox(
        'Pet Grok — port 7788 in use',
        'Could not bind 127.0.0.1:7788.\n\n' +
          platform.restartHint() +
          '\n\n' +
          String(err.message || err)
      );
    } catch {
      /* headless */
    }
  }

  registerIpc();
  createWindow();
  createTray();

  // Install/refresh hooks unless the user explicitly uninstalled them (S11)
  ensureHooksOnLaunch();
  rebuildTray();

  // Start idle (not mid-agent); only idle uses quiet timeout
  setTimeout(() => pushState('idle'), 400);
});

// Stay alive in the tray when the overlay is hidden/closed
app.on('window-all-closed', () => {
  // Intentionally empty — do not quit
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (idleTimer) clearTimeout(idleTimer);
  if (stateServer) {
    try {
      await stateServer.close();
    } catch {
      /* ignore */
    }
  }
});

app.on('quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
