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
 */
function resolveNodeBinary() {
  const base = path.basename(process.execPath).toLowerCase();
  if (base === 'node' || base === 'node.exe') {
    return process.execPath;
  }
  try {
    if (process.platform === 'win32') {
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

function quoteForShell(p) {
  // Safe double-quoted path for cmd / bash
  return `"${String(p).replace(/"/g, '\\"')}"`;
}

/**
 * Build command that Grok will run.
 * Windows: pet-run.cmd (path has no spaces under ~/.grok/hooks) so CreateProcess
 * / PowerShell / cmd all parse args correctly. The .cmd invokes node + pet-state.js.
 * macOS/Linux: node + absolute script path.
 */
function stateCommand(state, opts = {}) {
  const nodeBin = opts.nodeBin || resolveNodeBinary();
  const scriptPath = opts.scriptPath || HOOK_SCRIPT;
  const runnerPath = opts.runnerPath || HOOK_RUNNER;

  if (process.platform === 'win32') {
    // No quotes needed — homedir path typically has no spaces; .cmd receives %1
    return `${runnerPath} ${state}`;
  }
  return `${quoteForShell(nodeBin)} ${quoteForShell(scriptPath)} ${state}`;
}

/** Fallback curl one-liner (used only if forced). */
function curlStateCommand(state) {
  const bin = process.platform === 'win32' ? 'curl.exe' : 'curl';
  return `${bin} -s -X POST ${HOST}:${PORT}/state -d ${state}`;
}

function makeHooksPayload(opts = {}) {
  /** @type {Record<string, unknown>} */
  const hooks = {};
  for (const [event, state] of Object.entries(EVENT_STATE_MAP)) {
    const command = opts.forceCurl
      ? curlStateCommand(state)
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

function installHookScript() {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  const src = fs.readFileSync(BUNDLED_SCRIPT, 'utf8');
  fs.writeFileSync(HOOK_SCRIPT, src, 'utf8');

  if (process.platform === 'win32') {
    const nodeBin = resolveNodeBinary();
    // cmd wrapper: reliable under Grok's Windows hook runner (no space-splitting issues)
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
  }
  return HOOK_SCRIPT;
}

function installHooks() {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  installHookScript();
  const nodeBin = resolveNodeBinary();
  const payload = makeHooksPayload({
    nodeBin,
    scriptPath: HOOK_SCRIPT,
    runnerPath: HOOK_RUNNER,
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
