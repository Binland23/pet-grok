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
  { id: 'snorlax-buddy', name: 'Snorlax Buddy' },
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

  for (const expected of SHIPPED_THEMES) {
    it(`loadThemeJson reads theme.json for ${expected.id}`, () => {
      const meta = themes.loadThemeJson(expected.id);
      assert.ok(meta);
      assert.equal(meta.id, expected.id);
      assert.equal(meta.name, expected.name);
    });

    it(`themeAnimationsPath + assets for ${expected.id}`, () => {
      const p = themes.themeAnimationsPath(expected.id);
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
    });

    it(`smooth 24fps working pack for ${expected.id}`, () => {
      const p = themes.themeAnimationsPath(expected.id);
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const working = j.animations.working;
      assert.ok(working);
      assert.ok(working.frames.length >= 12, 'working should have a dense frame pack');
      assert.ok(working.fps >= 18, 'working fps should be smooth (≥18)');
      // Spot-check a mid frame exists (not just _00)
      const mid = working.frames[Math.min(8, working.frames.length - 1)];
      assert.ok(fs.existsSync(themes.themeAssetAbs(expected.id, mid)), mid);
    });
  }
});
