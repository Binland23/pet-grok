'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  readActiveSessions,
  pickActiveSession,
  processExists,
  resolveTerminalHost,
  getTty,
  focusActiveGrokTerminal,
  ACTIVE_SESSIONS_PATH,
} = require('../main/focus-terminal');

describe('focus-terminal (shipped helpers)', () => {
  it('readActiveSessions returns an array (live file or empty)', () => {
    const sessions = readActiveSessions();
    assert.ok(Array.isArray(sessions));
    for (const s of sessions) {
      assert.equal(typeof s.pid, 'number');
      assert.equal(typeof s.session_id, 'string');
    }
  });

  it('pickActiveSession prefers newest living pid', () => {
    const self = process.pid;
    const picked = pickActiveSession([
      {
        session_id: 'old',
        pid: 99999999,
        cwd: '/tmp',
        opened_at: '2020-01-01T00:00:00Z',
      },
      {
        session_id: 'live',
        pid: self,
        cwd: process.cwd(),
        opened_at: '2099-01-01T00:00:00Z',
      },
    ]);
    assert.ok(picked);
    assert.equal(picked.session_id, 'live');
    assert.equal(picked.pid, self);
  });

  it('processExists detects current process', () => {
    assert.equal(processExists(process.pid), true);
    assert.equal(processExists(99999999), false);
  });

  it('resolveTerminalHost returns shape for current pid', () => {
    const host = resolveTerminalHost(process.pid);
    assert.equal(typeof host.app, 'string');
    assert.equal(typeof host.tty, 'string');
    assert.equal(typeof host.terminalPid, 'number');
  });

  it('getTty returns string for current process', () => {
    const tty = getTty(process.pid);
    assert.equal(typeof tty, 'string');
  });

  it('sanitizeTty strips injection characters', () => {
    const { sanitizeTty, sanitizeAppName } = require('../main/focus-terminal');
    assert.equal(sanitizeTty('/dev/ttys001'), 'ttys001');
    assert.equal(sanitizeTty('ttys001"; do shell script "evil'), 'ttys001doshellscriptevil');
    assert.equal(sanitizeAppName('Terminal'), 'Terminal');
    assert.equal(sanitizeAppName('Term"inal'), 'Terminal');
  });

  it('ACTIVE_SESSIONS_PATH is under ~/.grok', () => {
    assert.ok(ACTIVE_SESSIONS_PATH.includes('.grok'));
    assert.ok(ACTIVE_SESSIONS_PATH.endsWith('active_sessions.json'));
  });

  it('parses a temp sessions file via read path contract', () => {
    // Drive the same JSON shape Grok writes, without mocking the module
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-grok-sessions-'));
    const file = path.join(dir, 'active_sessions.json');
    const payload = [
      {
        session_id: 'test-sess',
        pid: process.pid,
        cwd: '/tmp/project',
        opened_at: '2026-07-08T12:00:00Z',
      },
    ];
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const picked = pickActiveSession(
      raw.map((s) => ({
        session_id: String(s.session_id || ''),
        pid: Number(s.pid) || 0,
        cwd: String(s.cwd || ''),
        opened_at: s.opened_at ? String(s.opened_at) : '',
      }))
    );
    assert.equal(picked.session_id, 'test-sess');
    assert.equal(picked.cwd, '/tmp/project');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses the Windows terminal fallback when session metadata is empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-grok-empty-sessions-'));
    const file = path.join(dir, 'active_sessions.json');
    fs.writeFileSync(file, '[]', 'utf8');
    let receivedPid = -1;
    const result = await focusActiveGrokTerminal({
      sessionsPath: file,
      platform: 'win32',
      focusWindowsFn: async (pid) => {
        receivedPid = pid;
        return { ok: true, strategy: 'terminal-fallback', process: 'WindowsTerminal' };
      },
    });
    assert.equal(receivedPid, 0);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'terminal-fallback:WindowsTerminal');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses the Windows terminal fallback when the recorded session is stale', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-grok-stale-sessions-'));
    const file = path.join(dir, 'active_sessions.json');
    fs.writeFileSync(
      file,
      JSON.stringify([{ session_id: 'stale', pid: 99999999, cwd: 'C:\\project' }]),
      'utf8'
    );
    let receivedPid = -1;
    const result = await focusActiveGrokTerminal({
      sessionsPath: file,
      platform: 'win32',
      processExistsFn: () => false,
      focusWindowsFn: async (pid) => {
        receivedPid = pid;
        return { ok: true, strategy: 'terminal-fallback', process: 'WindowsTerminal' };
      },
    });
    assert.equal(receivedPid, 0);
    assert.equal(result.ok, true);
    assert.equal(result.session.session_id, 'stale');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prefers a living Windows session process when one is available', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-grok-live-sessions-'));
    const file = path.join(dir, 'active_sessions.json');
    fs.writeFileSync(
      file,
      JSON.stringify([{ session_id: 'live', pid: process.pid, cwd: process.cwd() }]),
      'utf8'
    );
    let receivedPid = 0;
    const result = await focusActiveGrokTerminal({
      sessionsPath: file,
      platform: 'win32',
      processExistsFn: (pid) => pid === process.pid,
      focusWindowsFn: async (pid) => {
        receivedPid = pid;
        return { ok: true, strategy: 'process-tree', process: 'node' };
      },
    });
    assert.equal(receivedPid, process.pid);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'process-tree:node');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('click animation asset (shipped animations.json)', () => {
  for (const themeId of ['race-crab', 'cloud-pup', 'bubble-axolotl', 'matcha-frog']) {
    it(`defines a click sequence for ${themeId}`, () => {
      const p = path.join(__dirname, '..', 'renderer', 'assets', themeId, 'animations.json');
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.ok(j.animations.click, 'click animation required');
      assert.ok(Array.isArray(j.animations.click.frames));
      assert.ok(j.animations.click.frames.length >= 2);
      for (const rel of j.animations.click.frames) {
        const abs = path.join(__dirname, '..', 'renderer', 'assets', themeId, rel);
        assert.ok(fs.existsSync(abs), 'missing frame ' + rel);
      }
    });
  }
});
