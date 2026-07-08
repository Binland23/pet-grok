'use strict';

/**
 * Focus the terminal (tab/window) hosting the active Grok TUI session.
 * Best-effort: macOS Terminal / iTerm2 / common apps; Windows console host.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const ACTIVE_SESSIONS_PATH = path.join(os.homedir(), '.grok', 'active_sessions.json');

/**
 * @returns {{ session_id: string, pid: number, cwd: string, opened_at?: string }[]}
 */
function readActiveSessions() {
  try {
    const raw = fs.readFileSync(ACTIVE_SESSIONS_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((s) => s && (s.pid || s.session_id))
      .map((s) => ({
        session_id: String(s.session_id || ''),
        pid: Number(s.pid) || 0,
        cwd: String(s.cwd || ''),
        opened_at: s.opened_at ? String(s.opened_at) : '',
      }));
  } catch {
    return [];
  }
}

/**
 * Prefer most recently opened living process.
 * @param {{ session_id: string, pid: number, cwd: string, opened_at?: string }[]} [sessions]
 */
function pickActiveSession(sessions) {
  const list = (sessions || readActiveSessions()).slice();
  list.sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')));
  for (const s of list) {
    if (s.pid > 0 && processExists(s.pid)) return s;
  }
  return list[0] || null;
}

function processExists(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {number} pid
 * @returns {number[]}
 */
function parentChain(pid) {
  const chain = [];
  let p = pid;
  for (let i = 0; i < 16 && p > 1; i++) {
    chain.push(p);
    const next = getPpid(p);
    if (!next || next === p) break;
    p = next;
  }
  return chain;
}

function getPpid(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'wmic',
        ['process', 'where', `ProcessId=${pid}`, 'get', 'ParentProcessId', '/value'],
        { encoding: 'utf8' }
      );
      const m = out.match(/ParentProcessId=(\d+)/i);
      return m ? Number(m[1]) : 0;
    }
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' }).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

function getCommand(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'wmic',
        ['process', 'where', `ProcessId=${pid}`, 'get', 'Name,ExecutablePath', '/value'],
        { encoding: 'utf8' }
      );
      return out.replace(/\r/g, '').trim();
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function getTty(pid) {
  try {
    if (process.platform === 'win32') return '';
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'tty='], { encoding: 'utf8' }).trim();
    if (!out || out === '??' || out === '?') return '';
    // ps may return "ttys001" — Terminal.app expects "ttys001" or full path
    return out.startsWith('/') ? out : `/dev/${out}`;
  } catch {
    return '';
  }
}

/**
 * Detect host terminal app from process ancestry.
 * @param {number} pid
 * @returns {{ app: string, tty: string, terminalPid: number }}
 */
function resolveTerminalHost(pid) {
  const tty = getTty(pid) || '';
  const chain = parentChain(pid);
  let app = '';
  let terminalPid = 0;
  for (const p of chain) {
    const cmd = getCommand(p).toLowerCase();
    if (!cmd) continue;
    if (cmd.includes('terminal.app') || /\/terminal$/i.test(cmd)) {
      app = 'Terminal';
      terminalPid = p;
      break;
    }
    if (cmd.includes('iterm') || cmd.includes('iterm2')) {
      app = 'iTerm2';
      terminalPid = p;
      break;
    }
    if (cmd.includes('ghostty')) {
      app = 'Ghostty';
      terminalPid = p;
      break;
    }
    if (cmd.includes('warp')) {
      app = 'Warp';
      terminalPid = p;
      break;
    }
    if (cmd.includes('alacritty')) {
      app = 'Alacritty';
      terminalPid = p;
      break;
    }
    if (cmd.includes('kitty')) {
      app = 'kitty';
      terminalPid = p;
      break;
    }
    if (cmd.includes('wezterm')) {
      app = 'WezTerm';
      terminalPid = p;
      break;
    }
    if (cmd.includes('windowsterminal') || cmd.includes('windows terminal')) {
      app = 'WindowsTerminal';
      terminalPid = p;
      break;
    }
    if (cmd.includes('code') || cmd.includes('cursor') || cmd.includes('electron')) {
      // IDE terminal — activate the IDE
      if (cmd.includes('cursor')) app = 'Cursor';
      else if (cmd.includes('code')) app = 'Visual Studio Code';
      else app = '';
      if (app) {
        terminalPid = p;
        break;
      }
    }
  }
  return { app, tty, terminalPid };
}

function runOsascript(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: (stderr || err.message || String(err)).trim() });
      } else {
        resolve({ ok: true, out: String(stdout || '').trim() });
      }
    });
  });
}

function activateMacApp(appName) {
  const escaped = String(appName).replace(/"/g, '\\"');
  return runOsascript(`tell application "${escaped}" to activate`);
}

/**
 * Focus Terminal.app tab by tty device (e.g. /dev/ttys001).
 * @param {string} tty
 */
async function focusMacTerminalApp(tty) {
  const bare = String(tty || '')
    .replace(/^\/dev\//, '')
    .replace(/"/g, '');
  if (!bare) {
    return activateMacApp('Terminal');
  }
  // Terminal.app exposes tty of each tab (often without /dev/)
  const script = `
tell application "Terminal"
  activate
  set targetTty to "${bare}"
  set targetTtyFull to "/dev/${bare}"
  repeat with w in windows
    try
      set tabList to tabs of w
      repeat with t in tabList
        set tabTty to tty of t as text
        if tabTty is targetTty or tabTty is targetTtyFull or tabTty ends with targetTty then
          set selected of t to true
          set frontmost of w to true
          return "ok"
        end if
      end repeat
    end try
  end repeat
  return "not-found"
end tell
`;
  const r = await runOsascript(script);
  if (!r.ok || r.out === 'not-found') {
    return activateMacApp('Terminal');
  }
  return r;
}

/**
 * Focus iTerm2 session by tty.
 * @param {string} tty
 */
async function focusITerm(tty) {
  const bare = String(tty || '')
    .replace(/^\/dev\//, '')
    .replace(/"/g, '');
  if (!bare) return activateMacApp('iTerm');
  const script = `
tell application "iTerm"
  activate
  set targetTty to "${bare}"
  set targetTtyFull to "/dev/${bare}"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        try
          set sTty to tty of s as text
          if sTty is targetTty or sTty is targetTtyFull or sTty ends with targetTty then
            select t
            select s
            return "ok"
          end if
        end try
      end repeat
    end repeat
  end repeat
  return "not-found"
end tell
`;
  const r = await runOsascript(script);
  if (!r.ok || r.out === 'not-found') {
    // iTerm app name may be iTerm2
    const r2 = await activateMacApp('iTerm2');
    if (!r2.ok) return activateMacApp('iTerm');
    return r2;
  }
  return r;
}

/**
 * Bring Windows window belonging to process tree to foreground (best-effort).
 * @param {number} pid
 */
function focusWindowsProcess(pid) {
  return new Promise((resolve) => {
    // PowerShell: find main window of process or parent chain and SetForegroundWindow
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
function Get-Parent($p) {
  try { (Get-CimInstance Win32_Process -Filter "ProcessId=$p").ParentProcessId } catch { 0 }
}
$pid = ${Number(pid) || 0}
$chain = @()
$p = $pid
for ($i=0; $i -lt 12 -and $p -gt 0; $i++) {
  $chain += $p
  $p = Get-Parent $p
}
foreach ($procId in $chain) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
    $h = $proc.MainWindowHandle
    if ([Win]::IsIconic($h)) { [Win]::ShowWindow($h, 9) | Out-Null }
    [Win]::SetForegroundWindow($h) | Out-Null
    "ok:$($proc.ProcessName)"
    exit 0
  }
}
# Fallback: Windows Terminal
$wt = Get-Process -Name WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -First 1
if ($wt -and $wt.MainWindowHandle -ne [IntPtr]::Zero) {
  [Win]::SetForegroundWindow($wt.MainWindowHandle) | Out-Null
  "ok:WindowsTerminal"
  exit 0
}
"not-found"
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 5000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: (stderr || err.message || '').trim() });
        } else {
          const out = String(stdout || '').trim();
          resolve({ ok: out.startsWith('ok'), out });
        }
      }
    );
  });
}

/**
 * Focus terminal hosting active Grok session.
 * @param {{ sessionsPath?: string }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, session?: object, host?: object }>}
 */
async function focusActiveGrokTerminal(opts = {}) {
  let sessions = readActiveSessions();
  if (opts.sessionsPath) {
    try {
      sessions = JSON.parse(fs.readFileSync(opts.sessionsPath, 'utf8'));
    } catch {
      /* keep default */
    }
  }
  const session = pickActiveSession(sessions);
  if (!session || !session.pid) {
    return { ok: false, reason: 'no-active-session' };
  }
  if (!processExists(session.pid)) {
    return { ok: false, reason: 'session-process-dead', session };
  }

  const host = resolveTerminalHost(session.pid);
  console.log('[focus-terminal]', { session, host });

  if (process.platform === 'darwin') {
    if (host.app === 'Terminal') {
      const r = await focusMacTerminalApp(host.tty);
      return { ok: r.ok, reason: r.ok ? 'terminal-tab' : r.error, session, host };
    }
    if (host.app === 'iTerm2' || host.app === 'iTerm') {
      const r = await focusITerm(host.tty);
      return { ok: r.ok, reason: r.ok ? 'iterm-session' : r.error, session, host };
    }
    if (host.app) {
      const r = await activateMacApp(host.app);
      return { ok: r.ok, reason: r.ok ? 'activate-app' : r.error, session, host };
    }
    // Fallback: try Terminal then iTerm
    let r = await focusMacTerminalApp(host.tty);
    if (r.ok) return { ok: true, reason: 'terminal-fallback', session, host };
    r = await focusITerm(host.tty);
    if (r.ok) return { ok: true, reason: 'iterm-fallback', session, host };
    return { ok: false, reason: 'no-terminal-host', session, host };
  }

  if (process.platform === 'win32') {
    const r = await focusWindowsProcess(session.pid);
    return { ok: r.ok, reason: r.ok ? r.out : r.error || 'not-found', session, host };
  }

  // Linux: best-effort wmctrl / xdotool not always available
  return { ok: false, reason: 'unsupported-platform', session, host };
}

module.exports = {
  ACTIVE_SESSIONS_PATH,
  readActiveSessions,
  pickActiveSession,
  processExists,
  parentChain,
  getTty,
  resolveTerminalHost,
  focusActiveGrokTerminal,
};
