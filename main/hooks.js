'use strict';

/**
 * Install / uninstall Grok global hooks for Pet Grok.
 *
 * Default path (macOS + Windows): type "http" → POST event JSON to
 * http://127.0.0.1:7788/hook. Grok's native HTTP runner maps lifecycle
 * events without spawning shell/node — more reliable than quoted command lines.
 *
 * Optional command / curl modes remain for tests and manual fallbacks.
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
  Notification: 'alert',
  SessionEnd: 'sleep',
};

/**
 * Resolve a node executable. When install runs inside Electron, process.execPath
 * is Electron — so prefer `node` on PATH.
 * @param {{ platform?: string }} [opts]
 */
function resolveNodeBinary(opts = {}) {
  const platform = opts.platform || process.platform;
  const base = path.basename(process.execPath).toLowerCase();
  if (base === 'node' || base === 'node.exe') {
    return process.execPath;
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
 * @param {string} p
 * @param {string} [platform]
 */
function quoteForShell(p, platform = process.platform) {
  const s = String(p);
  if (platform === 'win32') {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * Build a shell/cmd command for a fixed pet state (command mode / curl mode).
 * Prefer relative runners next to pet.json so Grok resolves them without quoting.
 * @param {string} state
 * @param {{
 *   nodeBin?: string,
 *   scriptPath?: string,
 *   runnerPath?: string,
 *   shRunnerPath?: string,
 *   platform?: string,
 * }} [opts]
 */
function stateCommand(state, opts = {}) {
  const platform = opts.platform || process.platform;
  const nodeBin = opts.nodeBin || resolveNodeBinary({ platform });
  const scriptPath = opts.scriptPath || HOOK_SCRIPT;
  const runnerPath = opts.runnerPath || HOOK_RUNNER;
  const shRunnerPath = opts.shRunnerPath || HOOK_SH_RUNNER;

  if (platform === 'win32') {
    // Relative name when installed next to pet.json — Grok resolves vs hook file dir
    const base = path.basename(runnerPath);
    if (runnerPath === HOOK_RUNNER || base === 'pet-run.cmd') {
      return `pet-run.cmd ${state}`;
    }
    return `${quoteForShell(runnerPath, platform)} ${state}`;
  }

  // macOS/Linux: relative shell runner (executable next to pet.json)
  const shBase = path.basename(shRunnerPath);
  if (shRunnerPath === HOOK_SH_RUNNER || shBase === 'pet-run.sh') {
    return `./pet-run.sh ${state}`;
  }
  return `${quoteForShell(nodeBin, platform)} ${quoteForShell(scriptPath, platform)} ${state}`;
}

/** Fallback curl one-liner. */
function curlStateCommand(state, opts = {}) {
  const platform = opts.platform || process.platform;
  const bin = platform === 'win32' ? 'curl.exe' : 'curl';
  return `${bin} -s -X POST ${HOST}:${PORT}/state -d ${state}`;
}

/**
 * Default: HTTP hooks. Grok POSTs the lifecycle event envelope as JSON.
 * @param {{
 *   forceCurl?: boolean,
 *   mode?: 'http' | 'command' | 'curl',
 *   nodeBin?: string,
 *   scriptPath?: string,
 *   runnerPath?: string,
 *   shRunnerPath?: string,
 *   platform?: string,
 *   hookUrl?: string,
 * }} [opts]
 */
function makeHooksPayload(opts = {}) {
  const mode = opts.mode || (opts.forceCurl ? 'curl' : 'http');
  const hookUrl = opts.hookUrl || HOOK_URL;
  /** @type {Record<string, unknown>} */
  const hooks = {};

  for (const [event, state] of Object.entries(EVENT_STATE_MAP)) {
    /** @type {{ type: string, command?: string, url?: string, timeout: number }} */
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
        timeout: 5,
      };
    } else {
      handler = {
        type: 'command',
        command: stateCommand(state, opts),
        timeout: 5,
      };
    }
    hooks[event] = [{ hooks: [handler] }];
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
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  const src = fs.readFileSync(BUNDLED_SCRIPT, 'utf8');
  fs.writeFileSync(HOOK_SCRIPT, src, 'utf8');

  // Unix shell runner (relative command for command-mode fallback)
  const shBody = [
    '#!/bin/sh',
    '# Pet Grok helper — invoked as: ./pet-run.sh <state>',
    'DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)',
    'STATE="$1"',
    'if [ -z "$STATE" ]; then',
    '  echo "usage: pet-run.sh <state>" >&2',
    '  exit 2',
    'fi',
    'exec /usr/bin/env node "$DIR/pet-state.js" "$STATE"',
    '',
  ].join('\n');
  fs.writeFileSync(HOOK_SH_RUNNER, shBody, { encoding: 'utf8', mode: 0o755 });
  try {
    fs.chmodSync(HOOK_SH_RUNNER, 0o755);
  } catch {
    /* windows may ignore */
  }

  if (platform === 'win32') {
    const nodeBin = opts.nodeBin || resolveNodeBinary({ platform });
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
  // Default HTTP — works on macOS and Windows without shell spawn issues
  const payload = makeHooksPayload({
    mode: opts.mode || 'http',
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
