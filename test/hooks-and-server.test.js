'use strict';

/**
 * Unit/integration tests against the real shipped modules
 * (main/hooks.js, main/state-server.js, main/pet-state-hook.js).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const hooks = require('../main/hooks');
const {
  parseStateBody,
  mapHookEventToState,
  startStateServer,
} = require('../main/state-server');

function post(port, urlPath, body, contentType) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': contentType || 'text/plain',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      })
      .on('error', reject);
  });
}

function runHookScript(state, scriptPath) {
  return new Promise((resolve) => {
    const node = process.execPath;
    const c = spawn(node, [scriptPath, state], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Simulate Grok: event JSON on stdin
    c.stdin.write(JSON.stringify({ hookEventName: 'user_prompt_submit', sessionId: 'test' }));
    // Do not end stdin immediately in all runners — leave open briefly then end
    setTimeout(() => {
      try {
        c.stdin.end();
      } catch {
        /* ignore */
      }
    }, 20);
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('close', (code) => resolve({ code, out, err }));
    c.on('error', (e) => resolve({ code: -1, out, err: e.message }));
  });
}

describe('hooks payload (real makeHooksPayload)', () => {
  it('maps UserPromptSubmit → thinking, PreToolUse → working, Stop → done', () => {
    const payload = hooks.makeHooksPayload();
    assert.ok(payload.hooks.UserPromptSubmit);
    assert.ok(payload.hooks.PreToolUse);
    assert.ok(payload.hooks.Stop);

    const cmdOf = (event) => payload.hooks[event][0].hooks[0].command;
    assert.match(cmdOf('UserPromptSubmit'), /thinking/);
    assert.match(cmdOf('PreToolUse'), /working/);
    assert.match(cmdOf('Stop'), /done/);
    if (process.platform === 'win32') {
      assert.match(cmdOf('UserPromptSubmit'), /pet-run\.cmd/);
    } else {
      assert.match(cmdOf('UserPromptSubmit'), /pet-state\.js/);
    }
  });

  it('generates win32 commands with pet-run.cmd even when not on Windows', () => {
    const payload = hooks.makeHooksPayload({
      platform: 'win32',
      nodeBin: 'C:\\\\Users\\\\First Last\\\\node.exe',
      runnerPath: 'C:\\\\Users\\\\First Last\\\\.grok\\\\hooks\\\\pet-run.cmd',
      scriptPath: 'C:\\\\Users\\\\First Last\\\\.grok\\\\hooks\\\\pet-state.js',
    });
    const cmd = payload.hooks.UserPromptSubmit[0].hooks[0].command;
    assert.match(cmd, /pet-run\.cmd/);
    assert.match(cmd, /thinking/);
    assert.match(cmd, /"/); // quoted for space-safe paths
    assert.doesNotMatch(cmd, /pet-state\.js thinking/); // runner, not direct node
  });

  it('generates darwin commands with quoted node + pet-state.js', () => {
    const payload = hooks.makeHooksPayload({
      platform: 'darwin',
      nodeBin: '/usr/local/bin/node',
      scriptPath: '/Users/Test User/.grok/hooks/pet-state.js',
    });
    const cmd = payload.hooks.PreToolUse[0].hooks[0].command;
    assert.match(cmd, /pet-state\.js/);
    assert.match(cmd, /working/);
    assert.match(cmd, /"/);
    assert.doesNotMatch(cmd, /pet-run\.cmd/);
  });

  it('forceCurl uses curl.exe on win32 and curl elsewhere', () => {
    assert.match(
      hooks.curlStateCommand('done', { platform: 'win32' }),
      /^curl\.exe /
    );
    assert.match(hooks.curlStateCommand('done', { platform: 'darwin' }), /^curl /);
  });

  it('installHooks writes pet.json + helper scripts with safe commands', () => {
    const prev = hooks.isInstalled() ? fs.readFileSync(hooks.HOOK_FILE, 'utf8') : null;
    const prevScript = fs.existsSync(hooks.HOOK_SCRIPT)
      ? fs.readFileSync(hooks.HOOK_SCRIPT, 'utf8')
      : null;
    const prevRunner = fs.existsSync(hooks.HOOK_RUNNER)
      ? fs.readFileSync(hooks.HOOK_RUNNER, 'utf8')
      : null;
    try {
      const p = hooks.installHooks();
      assert.equal(path.basename(p), 'pet.json');
      assert.ok(fs.existsSync(hooks.HOOK_SCRIPT), 'pet-state.js must be installed');
      if (process.platform === 'win32') {
        assert.ok(fs.existsSync(hooks.HOOK_RUNNER), 'pet-run.cmd must be installed');
      }
      const written = JSON.parse(fs.readFileSync(p, 'utf8'));
      const cmd = written.hooks.UserPromptSubmit[0].hooks[0].command;
      assert.match(cmd, /thinking/);
      assert.doesNotMatch(cmd, /<NUL|<\/dev\/null/);
      assert.doesNotMatch(cmd, /Program Files/); // avoid space-broken paths in the hook command itself
      const types = written.hooks.UserPromptSubmit[0].hooks.map((h) => h.type);
      assert.ok(types.every((t) => t === 'command'));
    } finally {
      if (prev != null) fs.writeFileSync(hooks.HOOK_FILE, prev, 'utf8');
      else if (hooks.isInstalled()) fs.unlinkSync(hooks.HOOK_FILE);
      if (prevScript != null) fs.writeFileSync(hooks.HOOK_SCRIPT, prevScript, 'utf8');
      if (prevRunner != null) fs.writeFileSync(hooks.HOOK_RUNNER, prevRunner, 'utf8');
      else if (fs.existsSync(hooks.HOOK_RUNNER) && process.platform !== 'win32') {
        try {
          fs.unlinkSync(hooks.HOOK_RUNNER);
        } catch {
          /* ignore */
        }
      }
    }
  });
});

describe('platform helpers', () => {
  const platform = require('../main/platform');

  it('pathToAssetUrl produces a file URL', () => {
    const sample =
      process.platform === 'win32'
        ? 'C:\\\\Users\\\\First Last\\\\pet\\\\frame.png'
        : '/Users/First Last/pet/frame.png';
    const url = platform.pathToAssetUrl(sample);
    assert.match(url, /^file:/);
    assert.ok(url.includes('frame.png') || url.includes('frame.png'.replace(/\//g, '%2F')));
  });

  it('exposes consistent tray / chrome flags', () => {
    assert.equal(typeof platform.trayOpensOnClick(), 'boolean');
    assert.ok(Array.isArray(platform.trayIconCandidates()));
    assert.ok(platform.trayIconCandidates().length > 0);
    assert.equal(typeof platform.restartHint(), 'string');
    assert.ok(platform.restartHint().length > 10);
  });
});

describe('parseStateBody (real shipped parser)', () => {
  it('accepts plain-text states', () => {
    for (const s of ['thinking', 'working', 'done', 'wake', 'idle', 'sleep', 'alert']) {
      assert.equal(parseStateBody(s), s);
    }
  });

  it('strips quotes and maps Grok event JSON', () => {
    assert.equal(parseStateBody("'thinking'"), 'thinking');
    assert.equal(
      parseStateBody(JSON.stringify({ hookEventName: 'user_prompt_submit' })),
      'thinking'
    );
    assert.equal(
      parseStateBody(JSON.stringify({ hookEventName: 'pre_tool_use' })),
      'working'
    );
    assert.equal(parseStateBody(JSON.stringify({ hookEventName: 'stop' })), 'done');
  });

  it('mapHookEventToState covers PascalCase and snake_case', () => {
    assert.equal(mapHookEventToState('UserPromptSubmit'), 'thinking');
    assert.equal(mapHookEventToState('PreToolUse'), 'working');
    assert.equal(mapHookEventToState('Stop'), 'done');
  });
});

describe('state server HTTP (real startStateServer)', () => {
  let server;
  let port;
  /** @type {string[]} */
  const received = [];

  before(async () => {
    server = await startStateServer((s) => received.push(s), { port: 0 });
    port = server.server.address().port;
  });

  after(async () => {
    if (server) await server.close();
  });

  it('POST plain-text thinking/working/done invokes onState in order', async () => {
    received.length = 0;
    for (const s of ['thinking', 'working', 'done']) {
      const r = await post(port, '/state', s);
      assert.equal(r.status, 200);
      assert.equal(r.body, s);
    }
    assert.deepEqual(received, ['thinking', 'working', 'done']);
    assert.equal(server.getLastState(), 'done');
  });

  it('POST /hook with Grok event JSON maps to pet states', async () => {
    received.length = 0;
    const r1 = await post(
      port,
      '/hook',
      JSON.stringify({ hookEventName: 'user_prompt_submit' }),
      'application/json'
    );
    assert.equal(r1.body, 'thinking');
    const r2 = await post(
      port,
      '/hook',
      JSON.stringify({ hookEventName: 'pre_tool_use' }),
      'application/json'
    );
    assert.equal(r2.body, 'working');
    const r3 = await post(port, '/hook', JSON.stringify({ hookEventName: 'stop' }), 'application/json');
    assert.equal(r3.body, 'done');
    assert.deepEqual(received, ['thinking', 'working', 'done']);
  });

  it('GET /health reports lastState and history', async () => {
    await post(port, '/state', 'thinking');
    const h = await get(port, '/health');
    const j = JSON.parse(h.body);
    assert.equal(j.ok, true);
    assert.equal(j.lastState, 'thinking');
    assert.ok(Array.isArray(j.history));
  });

  it('rejects unknown state with 400', async () => {
    const r = await post(port, '/state', 'not-a-state');
    assert.equal(r.status, 400);
  });
});

describe('pet-state-hook.js (real Grok hook script)', () => {
  let server;
  let port;
  /** @type {string[]} */
  const received = [];
  let scriptCopy;

  before(async () => {
    // Run a server on fixed port 17788 for the hook script (hardcodes 7788).
    // Instead, temporarily patch: start on 7788 only if free, else test script logic via spawn against live.
    // Prefer: spawn bundled script while main pet server is NOT required if we monkey port —
    // script hardcodes 7788. Start ephemeral and only run if 7788 free OR use bundled with env.
    // For honesty: start server on 7788 if available; skip if busy with clear assert path.
    try {
      server = await startStateServer((s) => received.push(s), { port: 7788 });
      port = 7788;
    } catch {
      // Port in use by live pet — still exercise script against live server
      server = null;
      port = 7788;
    }
    scriptCopy = path.join(__dirname, '..', 'main', 'pet-state-hook.js');
  });

  after(async () => {
    if (server) await server.close();
  });

  it('posts thinking with stdin JSON present and exits 0', async () => {
    received.length = 0;
    const r = await runHookScript('thinking', scriptCopy);
    assert.equal(r.code, 0, `hook script failed: ${r.err}`);
    // If we own the server, onState must fire; if live pet owns it, health must advance
    if (server) {
      assert.ok(received.includes('thinking'));
    } else {
      const h = await get(7788, '/health');
      const j = JSON.parse(h.body);
      assert.equal(j.lastState, 'thinking');
    }
  });

  it('posts working and done in sequence', async () => {
    for (const s of ['working', 'done']) {
      const r = await runHookScript(s, scriptCopy);
      assert.equal(r.code, 0, `failed on ${s}: ${r.err}`);
    }
    if (server) {
      assert.equal(server.getLastState(), 'done');
    } else {
      const h = await get(7788, '/health');
      assert.equal(JSON.parse(h.body).lastState, 'done');
    }
  });
});
