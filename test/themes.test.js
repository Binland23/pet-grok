'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const themes = require('../main/themes');

describe('themes module (shipped listThemes / paths)', () => {
  it('lists race-crab theme from themes/ on disk', () => {
    const list = themes.listThemes();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1, 'expected at least one theme');
    const crab = list.find((t) => t.id === 'race-crab');
    assert.ok(crab, 'race-crab must be discoverable');
    assert.equal(typeof crab.name, 'string');
    assert.ok(crab.name.length > 0);
  });

  it('loadThemeJson reads theme.json for race-crab', () => {
    const meta = themes.loadThemeJson('race-crab');
    assert.ok(meta);
    assert.equal(meta.id, 'race-crab');
    assert.ok(meta.name);
  });

  it('themeAnimationsPath points at an existing animations.json', () => {
    const p = themes.themeAnimationsPath('race-crab');
    assert.ok(fs.existsSync(p), p);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok(j.animations);
  });

  it('themeAssetAbs resolves a known frame path', () => {
    const abs = themes.themeAssetAbs('race-crab', 'frames/idle_00.png');
    assert.ok(fs.existsSync(abs), abs);
    assert.equal(path.basename(abs), 'idle_00.png');
  });
});
