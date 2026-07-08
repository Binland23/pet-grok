'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const HOOKS_DIR = path.join(os.homedir(), '.grok', 'hooks');
const HOOK_FILE = path.join(HOOKS_DIR, 'pet.json');
const HOOK_SCRIPT = path.join(HOOKS_DIR, 'pet-state.js');
const HOOK_RUNNER = path.join(HOOKS_DIR, 'pet-run.cmd');
const BUNDLED_SCRIPT = path.join(__dirname, 'pet-state-hook.js');
const PORT = 7788;
const HOST = '127.0.0.1';

/** Official Grok event → pet state map */
const EVENT_STATE_MAP = {
  SessionStart: 'wake',
  UserPromptSubmit: 'thinking',
  PreToolUse: 'working',
  PostToolUse: 'working',
  Stop: 'done',
  Notification: 'alert',
  SessionEnd: 'sleep',
};

/**
 * Resolve a node executable. When install runs inside Electron, process.execPath
 * is electron.exe — so prefer `node` on PATH.
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
 * Quote a path for shell / cmd consumption when it contains spaces or specials.
 * Always quote on Windows for CreateProcess safety with spaces in USERPROFILE.
 * @param {string} p
 * @param {string} [platform]
 */
function quoteForShell(p, platform = process.platform) {
  const s = String(p);
  if (platform === 'win32') {
    // cmd-safe double quotes; escape inner quotes
    return `"${s.replace(/"/g, '""')}"`;
  }
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * Build command that Grok will run.
 * Windows: pet-run.cmd so CreateProcess / PowerShell / cmd parse args correctly.
 * macOS/Linux: node + absolute script path.
 * @param {string} state
 * @param {{
 *   nodeBin?: string,
 *   scriptPath?: string,
 *   runnerPath?: string,
 *   platform?: string,
 * }} [opts]
 */
function stateCommand(state, opts = {}) {
  const platform = opts.platform || process.platform;
  const nodeBin = opts.nodeBin || resolveNodeBinary({ platform });
  const scriptPath = opts.scriptPath || HOOK_SCRIPT;
  const runnerPath = opts.runnerPath || HOOK_RUNNER;

  if (platform === 'win32') {
    // Quote runner path so "C:\Users\First Last\.grok\hooks\pet-run.cmd" works
    return `${quoteForShell(runnerPath, platform)} ${state}`;
  }
  return `${quoteForShell(nodeBin, platform)} ${quoteForShell(scriptPath, platform)} ${state}`;
}

/** Fallback curl one-liner (used only if forced). */
function curlStateCommand(state, opts = {}) {
  const platform = opts.platform || process.platform;
  const bin = platform === 'win32' ? 'curl.exe' : 'curl';
  return `${bin} -s -X POST ${HOST}:${PORT}/state -d ${state}`;
}

/**
 * @param {{
 *   forceCurl?: boolean,
 *   nodeBin?: string,
 *   scriptPath?: string,
 *   runnerPath?: string,
 *   platform?: string,
 * }} [opts]
 */
function makeHooksPayload(opts = {}) {
  /** @type {Record<string, unknown>} */
  const hooks = {};
  for (const [event, state] of Object.entries(EVENT_STATE_MAP)) {
    const command = opts.forceCurl
      ? curlStateCommand(state, opts)
      : stateCommand(state, opts);
    hooks[event] = [
      {
        hooks: [
          {
            type: 'command',
            command,
            timeout: 5,
          },
        ],
      },
    ];
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

  if (platform === 'win32') {
    const nodeBin = opts.nodeBin || resolveNodeBinary({ platform });
    // cmd wrapper: reliable under Grok's Windows hook runner
    const cmdBody = [
      '@echo off',
      'setlocal',
      `set "NODE_BIN=${nodeBin}"`,
      `set "SCRIPT=${HOOK_SCRIPT}"`,
      '"%NODE_BIN%" "%SCRIPT%" %1',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n');
    fs.writeFileSync(HOOK_RUNNER, cmdBody, 'utf8');
  } else if (fs.existsSync(HOOK_RUNNER)) {
    // Current platform is not Windows — remove stale .cmd from dual-boot
    try {
      fs.unlinkSync(HOOK_RUNNER);
    } catch {
      /* ignore */
    }
  }
  return HOOK_SCRIPT;
}

/**
 * @param {{ platform?: string, nodeBin?: string }} [opts]
 */
function installHooks(opts = {}) {
  const platform = opts.platform || process.platform;
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  const nodeBin = opts.nodeBin || resolveNodeBinary({ platform });
  installHookScript({ platform, nodeBin });
  const payload = makeHooksPayload({
    nodeBin,
    scriptPath: HOOK_SCRIPT,
    runnerPath: HOOK_RUNNER,
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
  for (const p of [HOOK_SCRIPT, HOOK_RUNNER]) {
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

module.exports = {
  HOOKS_DIR,
  HOOK_FILE,
  HOOK_SCRIPT,
  HOOK_RUNNER,
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
};
