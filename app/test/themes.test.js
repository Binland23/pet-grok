'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const themes = require('../main/themes');

const REQUIRED_STATES = ['idle', 'thinking', 'working', 'done', 'alert', 'sleep', 'wake'];
const SHIPPED_THEMES = [
  { id: 'race-crab', name: 'Hermit Crab' },
  { id: 'cloud-pup', name: 'Cloud Pup' },
  { id: 'bubble-axolotl', name: 'Bubble Axolotl' },
  { id: 'matcha-frog', name: 'Matcha Frog' },
];

describe('themes module (shipped listThemes / paths)', () => {
  it('lists all shipped themes from themes/ on disk', () => {
    const list = themes.listThemes();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= SHIPPED_THEMES.length, 'expected all shipped themes');
    for (const expected of SHIPPED_THEMES) {
      const t = list.find((x) => x.id === expected.id);
      assert.ok(t, `${expected.id} must be discoverable`);
      assert.equal(typeof t.name, 'string');
      assert.ok(t.name.length > 0);
      assert.ok(t.preview, `${expected.id} should have a preview path`);
      assert.ok(fs.existsSync(t.preview), t.preview);
    }
  });

  it('falls back when a saved theme is no longer installed', () => {
    assert.equal(themes.normalizeThemeId('matcha-frog'), 'matcha-frog');
    assert.equal(themes.normalizeThemeId('removed-theme'), 'race-crab');
    assert.equal(themes.normalizeThemeId('removed-theme', ''), '');
  });

  it('rejects path-traversal theme ids', () => {
    assert.equal(themes.sanitizeThemeId('../../etc/passwd'), null);
    assert.equal(themes.sanitizeThemeId('foo/bar'), null);
    assert.equal(themes.normalizeThemeId('../../etc/passwd'), 'race-crab');
    assert.equal(themes.normalizeThemeId('race-crab/../cloud-pup'), 'race-crab');
  });

  it('themeAssetAbs stays under theme asset roots', () => {
    const abs = themes.themeAssetAbs('race-crab', 'frames/idle_00.png');
    assert.ok(abs.includes('race-crab'));
    assert.ok(fs.existsSync(abs), abs);
    // Traversal in rel is stripped — must not escape renderer assets / themes
    const evil = path.resolve(themes.themeAssetAbs('race-crab', '../../../package.json'));
    const assetsRoot = path.resolve(themes.RENDERER_ASSETS) + path.sep;
    const themesRoot = path.resolve(themes.THEMES_DIR) + path.sep;
    assert.ok(
      evil.startsWith(assetsRoot) || evil.startsWith(themesRoot) ||
        evil === path.resolve(themes.RENDERER_ASSETS) ||
        evil === path.resolve(themes.THEMES_DIR),
      `unexpected path: ${evil}`
    );
    assert.notEqual(evil, path.resolve(path.join(__dirname, '..', 'package.json')));
  });

  for (const expected of SHIPPED_THEMES) {
    it(`loadThemeJson reads theme.json for ${expected.id}`, () => {
      const meta = themes.loadThemeJson(expected.id);
      assert.ok(meta);
      assert.equal(meta.id, expected.id);
      assert.equal(meta.name, expected.name);
    });

    it(`themeAnimationsPath + assets for ${expected.id}`, () => {
      const p = themes.themeAnimationsPath(expected.id, 'fluid');
      assert.ok(fs.existsSync(p), p);
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.ok(j.animations);
      for (const state of REQUIRED_STATES) {
        assert.ok(j.animations[state], `${expected.id} missing anim ${state}`);
        assert.ok(
          Array.isArray(j.animations[state].frames) && j.animations[state].frames.length > 0,
          `${expected.id} ${state} has no frames`
        );
        const first = j.animations[state].frames[0];
        const abs = themes.themeAssetAbs(expected.id, first);
        assert.ok(fs.existsSync(abs), abs);
      }
      const idleAbs = themes.themeAssetAbs(expected.id, 'frames/idle_00.png');
      assert.ok(fs.existsSync(idleAbs), idleAbs);
      for (const state of REQUIRED_STATES) {
        const heroAbs = themes.themeAssetAbs(expected.id, `${state}.png`);
        assert.ok(fs.existsSync(heroAbs), `${expected.id} missing hero ${state} sprite`);
      }
    });

    it(`classic static sprite packs for ${expected.id}`, () => {
      const p = themes.themeAnimationsPath(expected.id, 'static');
      assert.ok(fs.existsSync(p), p);
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.ok(j.animations);
      for (const state of REQUIRED_STATES) {
        assert.ok(j.animations[state], `${expected.id} static missing anim ${state}`);
        const frames = j.animations[state].frames;
        assert.ok(Array.isArray(frames) && frames.length >= 2, `${expected.id} static ${state} needs multi-frame cycle`);
        assert.ok(j.animations[state].fps > 0 && j.animations[state].fps <= 12, `${expected.id} static ${state} should be low-fps`);
        for (const rel of frames) {
          const abs = themes.themeAssetAbs(expected.id, rel);
          assert.ok(fs.existsSync(abs), abs);
        }
      }
      const working = j.animations.working;
      assert.ok(working.frames.length >= 4, 'static working should cycle several pose frames');
      assert.ok(working.fps >= 6 && working.fps <= 10, 'static working ~8–9fps');
    });

    it(`valid working animation pack for ${expected.id}`, () => {
      const p = themes.themeAnimationsPath(expected.id, 'fluid');
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const working = j.animations.working;
      assert.ok(working);
      assert.ok(working.frames.length >= 2, 'working should have multiple animation frames');
      assert.ok(working.fps > 0, 'working fps should be positive');
      if (expected.id !== 'matcha-frog') {
        assert.ok(working.frames.length >= 12, '24fps themes should have a dense frame pack');
        assert.ok(working.fps >= 18, '24fps themes should run smoothly');
      }
      // Spot-check a mid frame exists (not just _00)
      const mid = working.frames[Math.min(8, working.frames.length - 1)];
      assert.ok(fs.existsSync(themes.themeAssetAbs(expected.id, mid)), mid);
    });
  }
});
