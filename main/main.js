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
const { startStateServer } = require('./state-server');

const IDLE_TIMEOUT_MS = 60_000;
const THEMES_DIR = path.join(__dirname, '..', 'themes');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {ReturnType<typeof startStateServer> | null} */
let stateServer = null;
/** @type {NodeJS.Timeout | null} */
let idleTimer = null;
/** @type {ReturnType<typeof prefs.load> | null} */
let state = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getState() {
  if (!state) state = prefs.load();
  return state;
}

function loadTheme(themeId) {
  const s = getState();
  const id = themeId || s.themeId || 'race-crab';
  const themePath = path.join(THEMES_DIR, id, 'theme.json');
  try {
    return JSON.parse(fs.readFileSync(themePath, 'utf8'));
  } catch {
    return {
      id: 'race-crab',
      name: 'Race Engineer Crab',
      palette: {
        shell: '#1e3a5f',
        shellDark: '#0f2438',
        accent: '#e10600',
        highlight: '#ffd200',
        eye: '#ffffff',
        pupil: '#111111',
        belly: '#c45c26',
        claw: '#e10600',
      },
      celebrateMs: 2500,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
    };
  }
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
  const ms = loadTheme().idleTimeoutMs || IDLE_TIMEOUT_MS;
  idleTimer = setTimeout(() => {
    pushState('sleep');
  }, ms);
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

function appendPushLog(line) {
  try {
    fs.appendFileSync(pushStateLogPath(), line + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

function pushState(petState) {
  const at = Date.now();
  const hasWindow = !!(mainWindow && !mainWindow.isDestroyed());
  pushHistory.push({ state: petState, at, window: hasWindow });
  if (pushHistory.length > 40) pushHistory.shift();
  const line = `[pushState] ${petState} window=${hasWindow} at=${at}`;
  console.log(line);
  appendPushLog(line);

  if (hasWindow) {
    const send = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pet:state', petState);
        appendPushLog(`[pushState] IPC sent pet:state=${petState} at=${Date.now()}`);
      }
    };
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', send);
    } else {
      send();
    }
    // Keep window visible when agent is active
    if (petState !== 'sleep' && !mainWindow.isVisible() && getState().visible !== false) {
      mainWindow.showInactive();
    }
  }

  // Idle timeout policy:
  // - thinking/working/alert: agent mid-turn → never auto-sleep
  // - idle: start 60s quiet timer
  // - done/wake: brief; timer starts when we reach idle
  // - sleep: clear timer
  if (ACTIVE_AGENT_STATES.has(petState)) {
    clearIdleTimer();
  } else if (petState === 'idle') {
    resetIdleTimer();
  } else if (petState === 'sleep') {
    clearIdleTimer();
  } else if (petState === 'done') {
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
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  try {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    mainWindow.setVisibleOnAllWorkspaces(true);
  }

  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (getState().visible !== false) {
      mainWindow.showInactive();
    }
  });

  mainWindow.on('moved', () => {
    if (!mainWindow) return;
    const [nx, ny] = mainWindow.getPosition();
    const st = getState();
    st.x = nx;
    st.y = ny;
    prefs.save(st);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Race-engineer crab tray icon (color, not monochrome template). */
function createTrayImage() {
  const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
  const candidates =
    process.platform === 'win32'
      ? ['tray.ico', 'tray-32.png', 'tray-16.png', 'tray-256.png']
      : ['tray-32.png', 'tray-16.png', 'tray-64.png', 'tray-256.png', 'tray.ico'];

  for (const name of candidates) {
    const p = path.join(iconsDir, name);
    if (!fs.existsSync(p)) continue;
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) continue;
    // Menubar / tray prefers a small bitmap
    const size = process.platform === 'darwin' ? 22 : 16;
    if (img.getSize().width > size * 2) {
      img = img.resize({ width: size, height: size, quality: 'best' });
    }
    // Color icon — do NOT setTemplateImage (that forces greyscale on macOS)
    return img;
  }

  // Last-resort fallback pixel
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  );
}

/** Shared menu for tray + right-click on the pet */
function buildAppMenu() {
  const s = getState();
  const installed = hooks.isInstalled();
  return Menu.buildFromTemplate([
    {
      label: 'Pet Grok',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: s.visible === false ? 'Show Pet' : 'Hide Pet',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
          s.visible = false;
        } else {
          mainWindow.showInactive();
          s.visible = true;
        }
        prefs.save(s);
        rebuildTray();
      },
    },
    { type: 'separator' },
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
        s.mute = item.checked;
        prefs.save(s);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pet:prefs', { mute: s.mute, size: s.size });
        }
        rebuildTray();
      },
    },
    { type: 'separator' },
    {
      label: installed ? 'Uninstall Grok Hooks' : 'Install Grok Hooks',
      click: () => {
        if (hooks.isInstalled()) {
          hooks.uninstallHooks();
          console.log('[hooks] uninstalled', hooks.getHookFilePath());
        } else {
          const p = hooks.installHooks();
          console.log('[hooks] installed', p);
        }
        rebuildTray();
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
  tray.setContextMenu(buildAppMenu());
  tray.setToolTip('Pet Grok — Race Engineer Crab');
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
  const s = getState();
  s.size = key;
  prefs.save(s);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const size = prefs.sizePx(key);
  const [x, y] = mainWindow.getPosition();
  mainWindow.setBounds({ x, y, width: size, height: size });
  mainWindow.webContents.send('pet:prefs', { mute: s.mute, size: s.size });
}

function createTray() {
  tray = new Tray(createTrayImage());
  rebuildTray();
  tray.on('click', () => {
    if (process.platform === 'darwin') return;
    tray.popUpContextMenu();
  });
}

function registerIpc() {
  ipcMain.handle('pet:get-theme', () => loadTheme(getState().themeId));
  ipcMain.handle('pet:get-prefs', () => {
    const s = getState();
    return {
      mute: s.mute,
      size: s.size,
      themeId: s.themeId,
    };
  });
  ipcMain.handle('pet:get-push-history', () => pushHistory.slice(-20));
  ipcMain.handle('pet:get-animations', () => {
    const p = path.join(__dirname, '..', 'renderer', 'assets', 'race-crab', 'animations.json');
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) {
      console.error('[animations]', err.message);
      return null;
    }
  });
  ipcMain.handle('pet:asset-path', (_e, rel) => {
    // Return file:// URL for a renderer asset under assets/race-crab/
    const safe = String(rel || '').replace(/\\/g, '/').replace(/\.\./g, '');
    const abs = path.join(__dirname, '..', 'renderer', 'assets', 'race-crab', safe);
    return 'file:///' + abs.replace(/\\/g, '/');
  });

  ipcMain.on('pet:set-ignore', (_e, ignore) => {
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
  ipcMain.on('pet:drag-start', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = mainWindow.getPosition();
    mainWindow._dragOffset = { x: cursor.x - wx, y: cursor.y - wy };
    mainWindow.setIgnoreMouseEvents(false);
    // Snap size back to the configured preset before moving
    const size = windowSize();
    mainWindow.setBounds({ x: wx, y: wy, width: size, height: size });
  });

  ipcMain.on('pet:drag-move', () => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow._dragOffset) return;
    const cursor = screen.getCursorScreenPoint();
    const size = windowSize();
    const nx = Math.round(cursor.x - mainWindow._dragOffset.x);
    const ny = Math.round(cursor.y - mainWindow._dragOffset.y);
    mainWindow.setBounds({ x: nx, y: ny, width: size, height: size });
  });

  ipcMain.on('pet:drag-end', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow._dragOffset = null;
    const size = windowSize();
    const [x, y] = mainWindow.getPosition();
    // Final clamp so any DPI drift is discarded
    mainWindow.setBounds({ x, y, width: size, height: size });
    const s = getState();
    s.x = x;
    s.y = y;
    prefs.save(s);
  });

  ipcMain.on('pet:wake-from-idle', () => {
    pushState('idle');
  });

  ipcMain.on('pet:context-menu', () => {
    popupPetMenu();
  });
}

function maybeAutoInstallHooks() {
  const s = getState();
  if (!s.hooksAutoInstalled && !hooks.isInstalled()) {
    const p = hooks.installHooks();
    console.log('[hooks] auto-installed on first launch:', p);
    s.hooksAutoInstalled = true;
    prefs.save(s);
  } else if (hooks.isInstalled()) {
    s.hooksAutoInstalled = true;
    prefs.save(s);
  }
}

app.whenReady().then(async () => {
  state = prefs.load();

  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // Bind state server FIRST so hooks have a live target before window paints
  try {
    stateServer = await startStateServer((petState) => {
      console.log('[state]', petState);
      pushState(petState);
    });
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
        'Could not bind 127.0.0.1:7788.\n\nQuit other Pet Grok / Electron instances, then run RUN ME.bat again.\n\n' +
          String(err.message || err)
      );
    } catch {
      /* headless */
    }
  }

  registerIpc();
  createWindow();
  createTray();

  // Always install/refresh hooks so Grok TUI can reach this process
  try {
    const p = hooks.installHooks();
    console.log('[hooks] installed/refreshed', p);
    const s = getState();
    s.hooksAutoInstalled = true;
    prefs.save(s);
  } catch (err) {
    console.error('[hooks] install failed', err);
  }
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
