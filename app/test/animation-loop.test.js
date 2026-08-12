'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  advanceFrame,
  shouldPreserveFrame,
  framePathsForMode,
} = require('../renderer/animation-loop');

function sequence(frameCount, loopMode, steps) {
  let frameIndex = 0;
  let direction = 1;
  const result = [frameIndex];
  for (let i = 0; i < steps; i += 1) {
    const next = advanceFrame(frameIndex, direction, frameCount, true, loopMode);
    frameIndex = next.frameIndex;
    direction = next.direction;
    result.push(frameIndex);
  }
  return result;
}

describe('animation loop cursor', () => {
  it('ping-pongs through adjacent frames without duplicating endpoints', () => {
    assert.deepEqual(sequence(4, 'pingpong', 8), [0, 1, 2, 3, 2, 1, 0, 1, 2]);
  });

  it('handles a two-frame ping-pong loop', () => {
    assert.deepEqual(sequence(2, 'pingpong', 5), [0, 1, 0, 1, 0, 1]);
  });

  it('retains restart looping when explicitly requested', () => {
    assert.deepEqual(sequence(3, 'restart', 4), [0, 1, 2, 0, 1]);
  });

  it('marks a one-shot complete on its final frame', () => {
    assert.deepEqual(advanceFrame(1, 1, 3, false, 'restart'), {
      frameIndex: 2,
      direction: 1,
      completed: false,
    });
    assert.deepEqual(advanceFrame(2, 1, 3, false, 'restart'), {
      frameIndex: 2,
      direction: 1,
      completed: true,
    });
  });

  it('keeps a single-frame repeating animation stable', () => {
    assert.deepEqual(advanceFrame(0, 1, 1, true, 'pingpong'), {
      frameIndex: 0,
      direction: 1,
      completed: false,
    });
  });

  it('preserves an active continuous loop on a duplicate state event', () => {
    assert.equal(
      shouldPreserveFrame({
        force: false,
        next: 'working',
        current: 'working',
        loop: true,
        alwaysPlay: true,
        mode: 'play',
        playOnce: false,
      }),
      true
    );
  });

  it('allows forced reloads and one-shot states to restart', () => {
    const active = {
      next: 'working',
      current: 'working',
      loop: true,
      alwaysPlay: true,
      mode: 'play',
      playOnce: false,
    };
    assert.equal(shouldPreserveFrame({ ...active, force: true }), false);
    assert.equal(shouldPreserveFrame({ ...active, next: 'done', current: 'done', loop: false }), false);
    assert.equal(shouldPreserveFrame({ ...active, playOnce: true }), false);
  });

  it('selects classic static frame packs vs fluid frame packs', () => {
    const fluid = ['frames/working_00.png', 'frames/working_01.png'];
    const classic = [
      'frames-static/working_00.png',
      'frames-static/working_01.png',
      'frames-static/working_02.png',
    ];
    assert.deepEqual(framePathsForMode('working', fluid, 'fluid', classic), fluid);
    assert.deepEqual(framePathsForMode('working', fluid, 'static', classic), classic);
    // Themes without a separate static pack fall back to the fluid list
    assert.deepEqual(framePathsForMode('working', fluid, 'static', []), fluid);
  });
});

