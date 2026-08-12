'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SIZE_PRESETS = {
  S: 128,
  M: 192,
  L: 256,
};

const ANIMATION_MODES = ['fluid', 'static'];

const DEFAULTS = {
  x: null,
  y: null,
  size: 'M',
  mute: false,
  /**
   * Show the liquid-glass status bubble under the pet (live agent activity).
   * Default on so the existing under-pet status remains visible.
   */
  showStatus: true,
  themeId: 'race-crab',
  animationMode: 'fluid',
  /** Tray / menu-bar icon: 'grok' | 'match-pet' | theme id */
  trayIconId: 'grok',
  hooksAutoInstalled: false,
  /**
   * When true, user explicitly uninstalled hooks — do not reinstall on launch.
   * Cleared when they install hooks again from the dashboard/menu.
   */
  hooksUserDisabled: false,
  visible: true,
};

function prefsPath() {
  return path.join(app.getPath('userData'), 'pet-prefs.json');
}

function load() {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf8');
    const loaded = { ...DEFAULTS, ...JSON.parse(raw) };
    loaded.animationMode = normalizeAnimationMode(loaded.animationMode);
    return loaded;
  } catch {
    return { ...DEFAULTS };
  }
}

function normalizeAnimationMode(value) {
  const mode = String(value || '').toLowerCase();
  return ANIMATION_MODES.includes(mode) ? mode : DEFAULTS.animationMode;
}

function save(prefs) {
  const dir = path.dirname(prefsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf8');
}

function sizePx(sizeKey) {
  return SIZE_PRESETS[sizeKey] || SIZE_PRESETS.M;
}

module.exports = {
  SIZE_PRESETS,
  ANIMATION_MODES,
  DEFAULTS,
  load,
  save,
  sizePx,
  normalizeAnimationMode,
};
