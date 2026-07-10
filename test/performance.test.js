'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createBoundedLogger } = require('../main/bounded-log');
const { debounce } = require('../main/debounce');
const hooks = require('../main/hooks');
const themes = require('../main/themes');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('performance hardening', () => {
  it('keeps debug logging opt-in, asynchronous, and bounded', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-grok-log-'));
    const target = path.join(dir, 'debug.log');
    try {
      const disabled = createBoundedLogger({ enabled: false, filePath: target });
      await disabled.append('not written');
      assert.equal(fs.existsSync(target), false);

      const logger = createBoundedLogger({
        enabled: true,
        filePath: target,
        maxBytes: 128,
        keepBytes: 80,
      });
      for (let i = 0; i < 30; i += 1) void logger.append(`line-${i}-abcdefghij`);
      await logger.flush();
      assert.ok(fs.statSync(target).size <= 128);
      assert.match(fs.readFileSync(target, 'utf8'), /line-29/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('debounces repeated position saves and supports cancellation', async () => {
    let calls = 0;
    const task = debounce(() => { calls += 1; }, 20);
    task();
    task();
    task();
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.equal(calls, 1);
    task();
    task.cancel();
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(calls, 1);
  });

  it('caches theme directory and JSON reads until explicit invalidation', () => {
    themes.invalidateThemeCache();
    const originalRead = fs.readFileSync;
    let themeJsonReads = 0;
    fs.readFileSync = function countedRead(file, ...args) {
      if (String(file).endsWith(`${path.sep}theme.json`)) themeJsonReads += 1;
      return originalRead.call(this, file, ...args);
    };
    try {
      themes.listThemes();
      themes.loadThemeJson('race-crab');
      const firstPassReads = themeJsonReads;
      themes.listThemes();
      themes.loadThemeJson('race-crab');
      assert.equal(themeJsonReads, firstPassReads);
      themes.invalidateThemeCache('race-crab');
      themes.loadThemeJson('race-crab');
      assert.equal(themeJsonReads, firstPassReads + 1);
    } finally {
      fs.readFileSync = originalRead;
      themes.invalidateThemeCache();
    }
  });

  it('resolves one contained asset base for every shipped theme', () => {
    for (const theme of themes.listThemes()) {
      const base = path.resolve(themes.themeAssetBase(theme.id));
      assert.ok(base.startsWith(path.resolve(themes.RENDERER_ASSETS) + path.sep));
      assert.equal(fs.statSync(base).isDirectory(), true);
    }
  });

  it('prefers curl and retains the Node hook fallback', () => {
    assert.equal(hooks.preferredHookMode({ curlAvailable: true }), 'curl');
    assert.equal(hooks.preferredHookMode({ curlAvailable: false }), 'command');
    const curl = hooks.makeHooksPayload({ platform: 'win32', curlAvailable: true });
    assert.match(curl.hooks.PreToolUse[0].hooks[0].command, /^curl\.exe /);
    const node = hooks.makeHooksPayload({
      platform: 'win32',
      curlAvailable: false,
      nodeBin: 'C:\\node.exe',
      scriptPath: 'C:\\pet-state.js',
    });
    assert.match(node.hooks.PreToolUse[0].hooks[0].command, /pet-state\.js/);
  });

  it('uses on-demand state decoding and one asset-base IPC lookup', () => {
    const pet = read('renderer/pet.js');
    const preload = read('preload/preload.js');
    const main = read('main/main.js');
    assert.match(pet, /async function ensureStateAnimation\(state\)/);
    assert.match(pet, /await ensureStateAnimation\('idle'\)/);
    assert.match(pet, /def\.paths\.map\(\(rel\) => loadImage\(resolveAssetSrc\(rel\)\)\)/);
    assert.match(preload, /assetBase\(\)/);
    assert.doesNotMatch(preload, /assetPath\(rel\)/);
    assert.match(main, /ipcMain\.handle\('pet:asset-base'/);
    assert.doesNotMatch(main, /ipcMain\.handle\('pet:asset-path'/);
  });

  it('paces rendering, pauses while hidden, and reuses dashboard grids', () => {
    const pet = read('renderer/pet.js');
    const dashboard = read('renderer/dashboard.js');
    assert.match(pet, /visibilitychange/);
    assert.match(pet, /renderDirty/);
    assert.match(pet, /return 1000 \/ 30/);
    assert.match(pet, /1000 \/ Math\.max\(1, p\.fps\)/);
    assert.match(dashboard, /petsSignature/);
    assert.match(dashboard, /trayIconsSignature/);
    assert.match(dashboard, /signature !== petsSignature/);
    assert.match(dashboard, /signature !== trayIconsSignature/);
  });

  it('keeps source media and unused sheets out of runtime assets and packages', () => {
    const runtimeFiles = walk(path.join(ROOT, 'renderer', 'assets'));
    assert.equal(runtimeFiles.some((file) => /[\\/]videos[\\/].+\.mp4$/i.test(file)), false);
    assert.equal(runtimeFiles.some((file) => /spritesheet\.(png|json)$/i.test(file)), false);
    const themeSheets = walk(path.join(ROOT, 'themes')).filter((file) => /spritesheet\.png$/i.test(file));
    assert.deepEqual(themeSheets, []);
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.build.files.includes('!renderer/assets/**/_video_work/**'));
    assert.ok(pkg.build.files.includes('!media-src/**'));
  });
});
