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

  /**
   * Choose frame paths for the active animation mode.
   *
   * - fluid: 24fps Imagine smooth packs (frames/ + animations.json)
   * - static: classic low-fps sprite packs (frames-static/ + animations-static.json)
   *
   * When staticFrames is omitted/empty, fall back to fluidFrames so themes that
   * only ship one pack (e.g. matcha-style) still animate.
   *
   * @param {string} state
   * @param {string[]} fluidFrames
   * @param {'fluid' | 'static'} animationMode
   * @param {string[]} [staticFrames]
   */
  function framePathsForMode(state, fluidFrames, animationMode, staticFrames) {
    if (animationMode === 'static') {
      if (Array.isArray(staticFrames) && staticFrames.length) return staticFrames;
      return Array.isArray(fluidFrames) ? fluidFrames : [];
    }
    return Array.isArray(fluidFrames) ? fluidFrames : [];
  }

  return { advanceFrame, shouldPreserveFrame, framePathsForMode };
});
