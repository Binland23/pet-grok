'use strict';

(function exposeAnimationLoop(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PetAnimationLoop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAnimationLoop() {
  /**
   * Advance one animation frame.
   *
   * Ping-pong loops reverse before crossing the seam, so every displayed
   * transition uses two adjacent source frames. Endpoints are not duplicated.
   */
  function advanceFrame(frameIndex, direction, frameCount, repeat, loopMode) {
    if (frameCount <= 1) {
      return { frameIndex: 0, direction: 1, completed: !repeat };
    }

    const step = direction < 0 ? -1 : 1;
    const next = frameIndex + step;

    if (repeat && loopMode === 'pingpong') {
      if (next >= frameCount) {
        return { frameIndex: frameCount - 2, direction: -1, completed: false };
      }
      if (next < 0) {
        return { frameIndex: 1, direction: 1, completed: false };
      }
      return { frameIndex: next, direction: step, completed: false };
    }

    if (next >= frameCount) {
      if (repeat) return { frameIndex: 0, direction: 1, completed: false };
      return { frameIndex: frameCount - 1, direction: 1, completed: true };
    }

    return { frameIndex: Math.max(0, next), direction: step, completed: false };
  }

  function shouldPreserveFrame({ force, next, current, loop, alwaysPlay, mode, playOnce }) {
    return Boolean(
      !force &&
      next === current &&
      loop &&
      alwaysPlay &&
      mode === 'play' &&
      !playOnce
    );
  }

  function framePathsForMode(state, fluidFrames, animationMode) {
    if (animationMode === 'static') {
      return state === 'click' ? [] : [`${state}.png`];
    }
    return Array.isArray(fluidFrames) ? fluidFrames : [];
  }

  return { advanceFrame, shouldPreserveFrame, framePathsForMode };
});
