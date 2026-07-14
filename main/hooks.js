'use strict';

/**
 * Install / uninstall Grok global hooks for Pet Grok.
 *
 * Default path (macOS + Windows): type "command" with absolute node + pet-state.js
 * (same shape as Clawd-on-Desk hooks that Grok already loads from ~/.claude/settings.json).
 *
 * Why not type "http" to localhost? Grok's HTTP hook runner SSRF-blocks private/loopback
 * IPs, so http://127.0.0.1:7788 never fires.
 *
 * Why absolute paths? Relative "./pet-run.sh" is easy for the harness to skip/fail at load
 * or spawn; Clawd uses absolute quoted node + script and those show up in /hooks.
 *
 * Optional mode: "http" | "curl" | "command" remain for tests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const HOOKS_DIR = path.join(os.homedir(), '.grok', 'hooks');
const HOOK_FILE = path.join(HOOKS_DIR, 'pet.json');
const HOOK_SCRIPT = path.join(HOOKS_DIR, 'pet-state.js');
const HOOK_RUNNER = path.join(HOOKS_DIR, 'pet-run.cmd');
const HOOK_SH_RUNNER = path.join(HOOKS_DIR, 'pet-run.sh');
const BUNDLED_SCRIPT = path.join(__dirname, 'pet-state-hook.js');
const PORT = 7788;
const HOST = '127.0.0.1';
const HOOK_URL = `http://${HOST}:${PORT}/hook`;

/** Official Grok event → pet state map (server also maps snake_case envelopes). */
const EVENT_STATE_MAP = {
  SessionStart: 'wake',
  UserPromptSubmit: 'thinking',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PostToolUseFailure: 'alert',
  Stop: 'done',
  /**
   * Notification is usually turn_complete (not an emergency). Install as idle;
   * pet-state.js still upgrades approval_required / agent_error → alert from stdin.
   */
  Notification: 'idle',
  SessionEnd: 'sleep',
};

/** Events where matcher is meaningful (tool / notification filters). */
const TOOLISH_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
  'Notification',
]);

/**
 * Resolve a node executable. When install runs inside Electron, process.execPath
 * is Electron — so prefer `node` on PATH.
 * @param {{ platform?: string }} [opts]
 */
function resolveNodeBinary(opts = {}) {
  const platform = opts.platform || process.platform;
  const base = path.basename(process.execPath).toLowerCase();
  if (base === 'node' || base === 'node.exe') {
    // Prefer stable brew symlinks over versioned Cellar paths (survive upgrades)
    if (platform !== 'win32') {
      for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
        try {
          if (fs.existsSync(candidate)) return candidate;
        } catch {
          /* ignore */
        }
      }
    }
    return process.execPath;
  }
  // Prefer stable Homebrew shims first (not Cellar versioned paths)
  if (platform !== 'win32') {
    for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* ignore */
      }
    }
  }
  try {
    if (platform === 'win32') {
      const out = execSync('where node', { encoding: 'utf8' });
      const first = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (first) return first;
    } else {
      const out = execSync('command -v node', { encoding: 'utf8' }).trim();
      if (out) return out;
    }
  } catch {
    /* fall through */
  }
  return 'node';
}

/**
 * Quote a path for shell use.
 * POSIX: single-quote with `'\''` escaping so `$`, backticks, and `\` are literal.
 * Windows: double-quote with `""` for embedded quotes.
 * @param {string} p
 * @param {string} [platform]
 */
function quoteForShell(p, platform = process.platform) {
  const s = String(p);
  if (platform === 'win32') {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a command Grok can spawn reliably.
 * Prefer absolute node + absolute pet-state.js (Clawd-compatible).
 * @param {string} state
 * @param {{
 *   nodeBin?: string,
 *   scriptPath?: string,
 *   runnerPath?: string,
 *   shRunnerPath?: string,
 *   platform?: string,
 *   relative?: boolean,
 * }} [opts]
 */
function stateCommand(state, opts = {}) {
  const platform = opts.platform || process.platform;
  const nodeBin = opts.nodeBin || resolveNodeBinary({ platform });
  const scriptPath = opts.scriptPath || HOOK_SCRIPT;
  const runnerPath = opts.runnerPath || HOOK_RUNNER;
  const shRunnerPath = opts.shRunnerPath || HOOK_SH_RUNNER;

  // Explicit relative mode (tests / advanced)
  if (opts.relative) {
    if (platform === 'win32') {
      return `pet-run.cmd ${state}`;
    }
    return `./pet-run.sh ${state}`;
  }

  // Windows: absolute node + script (same as Clawd style)
  if (platform === 'win32') {
    // Prefer absolute if the runner exists; otherwise node+script
    if (fs.existsSync(runnerPath) || path.basename(runnerPath) === 'pet-run.cmd') {
      // Still use node+script — more reliable than cmd relative resolution
    }
    return `${quoteForShell(nodeBin, platform)} ${quoteForShell(scriptPath, platform)} ${state}`;
  }

  // macOS/Linux: absolute quoted node + absolute script (matches Clawd-on-Desk)
  return `${quoteForShell(nodeBin, platform)} ${quoteForShell(scriptPath, platform)} ${state}`;
}

/** Fallback curl one-liner. */
function curlStateCommand(state, opts = {}) {
  const platform = opts.platform || process.platform;
  const bin = platform === 'win32' ? 'curl.exe' : 'curl';
  return `${bin} -s -X POST ${HOST}:${PORT}/state -d ${state}`;
}

/** Determine whether curl can service hooks without a Node cold start. */
function isCurlAvailable(opts = {}) {
  if (typeof opts.curlAvailable === 'boolean') return opts.curlAvailable;
  const platform = opts.platform || process.platform;
  try {
    execSync(platform === 'win32' ? 'where curl.exe' : 'command -v curl', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function preferredHookMode(opts = {}) {
  if (opts.mode) return opts.mode;
  if (opts.forceCurl) return 'curl';
  return isCurlAvailable(opts) ? 'curl' : 'command';
}

/**
 * Default: command hooks (absolute node → pet-state.js → state server).
 * Shape mirrors Clawd hooks that Grok successfully loads from Claude settings.
 * @param {{
 *   forceCurl?: boolean,
 *   mode?: 'http' | 'command' | 'curl',
 *   nodeBin?: string,
 *   scriptPath?: string,
 *   runnerPath?: string,
 *   shRunnerPath?: string,
 *   platform?: string,
 *   hookUrl?: string,
 *   relative?: boolean,
 * }} [opts]
 */
function makeHooksPayload(opts = {}) {
  const mode = preferredHookMode(opts);
  const hookUrl = opts.hookUrl || HOOK_URL;
  /** @type {Record<string, unknown>} */
  const hooks = {};

  for (const [event, state] of Object.entries(EVENT_STATE_MAP)) {
    /** @type {{ type: string, command?: string, url?: string, timeout: number, async?: boolean }} */
    let handler;
    if (mode === 'http') {
      handler = {
        type: 'http',
        url: hookUrl,
        timeout: 5,
      };
    } else if (mode === 'curl' || opts.forceCurl) {
      handler = {
        type: 'command',
        command: curlStateCommand(state, opts),
        async: true,
        timeout: 5,
      };
    } else {
      handler = {
        type: 'command',
        command: stateCommand(state, opts),
        // Non-blocking like Clawd — pet never stalls the agent turn
        async: true,
        timeout: 5,
      };
    }

    /** @type {{ matcher?: string, hooks: typeof handler[] }} */
    const group = { hooks: [handler] };
    // Clawd uses matcher:"" on every event; empty = match all tools for tool events.
    // Include for toolish events always; for lifecycle too (matches Clawd UI listing).
    if (TOOLISH_EVENTS.has(event) || mode === 'command') {
      group.matcher = '';
    }
    hooks[event] = [group];
  }
  return { hooks };
}

const PET_HOOKS = makeHooksPayload();

function isInstalled() {
  return fs.existsSync(HOOK_FILE);
}

/**
 * @param {{ platform?: string, nodeBin?: string }} [opts]
 */
function installHookScript(opts = {}) {
  const platform = opts.platform || process.platform;
  const nodeBin = opts.nodeBin || resolveNodeBinary({ platform });
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  const src = fs.readFileSync(BUNDLED_SCRIPT, 'utf8');
  fs.writeFileSync(HOOK_SCRIPT, src, 'utf8');

  // Unix shell runner (manual / relative fallback)
  const shBody = [
    '#!/bin/sh',
    '# Pet Grok helper — invoked as: ./pet-run.sh <state>',
    'DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)',
    'STATE="$1"',
    'if [ -z "$STATE" ]; then',
    '  echo "usage: pet-run.sh <state>" >&2',
    '  exit 2',
    'fi',
    // Prefer absolute node when available (POSIX single-quote quoting)
    `NODE_BIN=${quoteForShell(nodeBin, 'darwin')}`,
    'if [ ! -x "$NODE_BIN" ]; then NODE_BIN="$(command -v node 2>/dev/null || true)"; fi',
    'if [ -z "$NODE_BIN" ]; then NODE_BIN="node"; fi',
    'exec "$NODE_BIN" "$DIR/pet-state.js" "$STATE"',
    '',
  ].join('\n');
  fs.writeFileSync(HOOK_SH_RUNNER, shBody, { encoding: 'utf8', mode: 0o755 });
  try {
    fs.chmodSync(HOOK_SH_RUNNER, 0o755);
  } catch {
    /* windows may ignore */
  }

  if (platform === 'win32') {
    const cmdBody = [
      '@echo off',
      'setlocal',
      `set "NODE_BIN=${nodeBin}"`,
      `set "SCRIPT=%~dp0pet-state.js"`,
      '"%NODE_BIN%" "%SCRIPT%" %1',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n');
    fs.writeFileSync(HOOK_RUNNER, cmdBody, 'utf8');
  } else if (fs.existsSync(HOOK_RUNNER)) {
    try {
      fs.unlinkSync(HOOK_RUNNER);
    } catch {
      /* ignore */
    }
  }
  return HOOK_SCRIPT;
}

/**
 * @param {{ platform?: string, nodeBin?: string, mode?: string }} [opts]
 */
function installHooks(opts = {}) {
  const platform = opts.platform || process.platform;
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  const nodeBin = opts.nodeBin || resolveNodeBinary({ platform });
  installHookScript({ platform, nodeBin });
  const payload = makeHooksPayload({
    mode: preferredHookMode(opts),
    nodeBin,
    scriptPath: HOOK_SCRIPT,
    runnerPath: HOOK_RUNNER,
    shRunnerPath: HOOK_SH_RUNNER,
    platform,
  });
  fs.writeFileSync(HOOK_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return HOOK_FILE;
}

function uninstallHooks() {
  let removed = false;
  if (fs.existsSync(HOOK_FILE)) {
    fs.unlinkSync(HOOK_FILE);
    removed = true;
  }
  for (const p of [HOOK_SCRIPT, HOOK_RUNNER, HOOK_SH_RUNNER]) {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        removed = true;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

function getHookFilePath() {
  return HOOK_FILE;
}

function getHooksPayload() {
  return makeHooksPayload();
}

function getEventStateMap() {
  return { ...EVENT_STATE_MAP };
}

function getHookUrl() {
  return HOOK_URL;
}

module.exports = {
  HOOKS_DIR,
  HOOK_FILE,
  HOOK_SCRIPT,
  HOOK_RUNNER,
  HOOK_SH_RUNNER,
  HOOK_URL,
  PET_HOOKS,
  EVENT_STATE_MAP,
  resolveNodeBinary,
  quoteForShell,
  stateCommand,
  curlStateCommand,
  isCurlAvailable,
  preferredHookMode,
  makeHooksPayload,
  isInstalled,
  installHookScript,
  installHooks,
  uninstallHooks,
  getHookFilePath,
  getHooksPayload,
  getEventStateMap,
  getHookUrl,
};
