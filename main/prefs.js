'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SIZE_PRESETS = {
  S: 128,
  M: 192,
  L: 256,
};

const DEFAULTS = {
  x: null,
  y: null,
  size: 'M',
  mute: false,
  themeId: 'race-crab',
  hooksAutoInstalled: false,
  visible: true,
};

function prefsPath() {
  return path.join(app.getPath('userData'), 'pet-prefs.json');
}

function load() {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf8');
    const loaded = { ...DEFAULTS, ...JSON.parse(raw) };
    // Preserve the selected sleepy pet for users upgrading from v1.1.0.
    if (loaded.themeId === 'snorlax-buddy') {
      loaded.themeId = 'doze-buddy';
    }
    return loaded;
  } catch {
    return { ...DEFAULTS };
  }
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
  DEFAULTS,
  load,
  save,
  sizePx,
};
