'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_KEEP_BYTES = 192 * 1024;

/**
 * Create an opt-in, non-blocking, size-bounded text logger.
 * Writes are serialized so concurrent state events cannot race rotation.
 */
function createBoundedLogger({
  enabled = false,
  filePath,
  maxBytes = DEFAULT_MAX_BYTES,
  keepBytes = DEFAULT_KEEP_BYTES,
} = {}) {
  let pending = Promise.resolve();

  async function appendNow(line) {
    const target = typeof filePath === 'function' ? filePath() : filePath;
    if (!target) return;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.appendFile(target, String(line) + '\n', 'utf8');
    const stat = await fs.promises.stat(target);
    if (stat.size <= maxBytes) return;
    const data = await fs.promises.readFile(target);
    const start = Math.max(0, data.length - Math.min(keepBytes, maxBytes));
    await fs.promises.writeFile(target, data.subarray(start));
  }

  function append(line) {
    if (!enabled) return Promise.resolve(false);
    pending = pending
      .then(() => appendNow(line))
      .catch(() => {});
    return pending.then(() => true);
  }

  return {
    append,
    flush: () => pending,
    enabled: !!enabled,
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_KEEP_BYTES,
  createBoundedLogger,
};
