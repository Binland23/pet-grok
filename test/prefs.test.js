'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const prefs = require('../main/prefs');

describe('animation mode preference', () => {
  it('defaults to fluid animation', () => {
    assert.equal(prefs.DEFAULTS.animationMode, 'fluid');
  });

  it('defaults hooksUserDisabled to false', () => {
    assert.equal(prefs.DEFAULTS.hooksUserDisabled, false);
  });

  it('accepts the two supported modes', () => {
    assert.equal(prefs.normalizeAnimationMode('fluid'), 'fluid');
    assert.equal(prefs.normalizeAnimationMode('static'), 'static');
  });

  it('falls back to fluid for invalid or missing values', () => {
    assert.equal(prefs.normalizeAnimationMode('cinematic'), 'fluid');
    assert.equal(prefs.normalizeAnimationMode(null), 'fluid');
  });
});
