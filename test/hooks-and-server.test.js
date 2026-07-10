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

function post(port, urlPath, body, contentType, extraHeaders) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': contentType || 'text/plain',
      'Content-Length': Buffer.byteLength(body),
      ...(extraHeaders || {}),
    };
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers,
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
    c.stdin.write(JSON.stringify({ hookEventName: 'user_prompt_submit', sessionId: 'test' }));
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

/** Simulate Grok HTTP hook: POST event envelope to installed URL path. */
function postGrokHttpHook(port, hookEventName) {
  return post(
    port,
    '/hook',
    JSON.stringify({
      hookEventName,
      sessionId: 'test-session',
      cwd: process.cwd(),
    }),
    'application/json'
  );
}

describe('hooks payload (real makeHooksPayload)', () => {
  it('default payload uses type command (loopback HTTP is SSRF-blocked by Grok)', () => {
    const payload = hooks.makeHooksPayload();
    assert.ok(payload.hooks.UserPromptSubmit);
    assert.ok(payload.hooks.PreToolUse);
    assert.ok(payload.hooks.Stop);

    const handlerOf = (event) => payload.hooks[event][0].hooks[0];
    for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
      const h = handlerOf(event);
      assert.equal(h.type, 'command', `${event} must be command (not http to 127.0.0.1)`);
      assert.equal(typeof h.command, 'string');
      assert.ok(h.command.length > 0, `${event} needs a command`);
      assert.equal(h.timeout, 5);
    }
    // Fixed states embedded in commands so pet-state.js does not need the envelope
    assert.match(handlerOf('UserPromptSubmit').command, /thinking/);
    assert.match(handlerOf('PreToolUse').command, /working/);
    assert.match(handlerOf('Stop').command, /done/);
  });

  it('http mode still builds a localhost /hook URL when explicitly requested', () => {
    const payload = hooks.makeHooksPayload({ mode: 'http' });
    const h = payload.hooks.UserPromptSubmit[0].hooks[0];
    assert.equal(h.type, 'http');
    assert.match(h.url, /127\.0\.0\.1:7788\/hook/);
  });

  it('maps events in EVENT_STATE_MAP for thinking/working/done', () => {
    const map = hooks.getEventStateMap();
    assert.equal(map.UserPromptSubmit, 'thinking');
    assert.equal(map.PreToolUse, 'working');
    assert.equal(map.Stop, 'done');
  });

  it('command mode uses absolute node + pet-state.js (Clawd-compatible)', () => {
    const win = hooks.makeHooksPayload({
      mode: 'command',
      platform: 'win32',
      nodeBin: 'C:\\\\Program Files\\\\nodejs\\\\node.exe',
      scriptPath: 'C:\\\\Users\\\\x\\\\.grok\\\\hooks\\\\pet-state.js',
    });
    const winCmd = win.hooks.UserPromptSubmit[0].hooks[0];
    assert.equal(winCmd.type, 'command');
    assert.equal(winCmd.async, true);
    assert.match(winCmd.command, /node\.exe/i);
    assert.match(winCmd.command, /pet-state\.js/);
    assert.match(winCmd.command, /thinking/);

    const mac = hooks.makeHooksPayload({
      mode: 'command',
      platform: 'darwin',
      nodeBin: '/opt/homebrew/bin/node',
      scriptPath: '/Users/x/.grok/hooks/pet-state.js',
    });
    const macCmd = mac.hooks.PreToolUse[0].hooks[0];
    assert.equal(macCmd.type, 'command');
    assert.equal(macCmd.async, true);
    // POSIX single-quote quoting
    assert.match(macCmd.command, /'\/opt\/homebrew\/bin\/node'|node/);
    assert.match(macCmd.command, /pet-state\.js/);
    assert.match(macCmd.command, /working/);
    // Tool events get empty matcher (match all) like Clawd
    assert.equal(mac.hooks.PreToolUse[0].matcher, '');
  });

  it('quoteForShell uses single quotes on POSIX (no $ expansion)', () => {
    const q = hooks.quoteForShell("/tmp/foo's/node", 'darwin');
    assert.equal(q, `'/tmp/foo'\\''s/node'`);
    const win = hooks.quoteForShell('C:\\Program Files\\node.exe', 'win32');
    assert.equal(win, '"C:\\Program Files\\node.exe"');
  });

  it('relative command mode still available for tests', () => {
    const mac = hooks.makeHooksPayload({ mode: 'command', platform: 'darwin', relative: true });
    assert.match(mac.hooks.PreToolUse[0].hooks[0].command, /pet-run\.sh/);
  });

  it('forceCurl uses curl.exe on win32 and curl elsewhere', () => {
    assert.match(hooks.curlStateCommand('done', { platform: 'win32' }), /^curl\.exe /);
    assert.match(hooks.curlStateCommand('done', { platform: 'darwin' }), /^curl /);
  });

  it('installHooks writes pet.json with command handlers + helper scripts', () => {
    const prev = hooks.isInstalled() ? fs.readFileSync(hooks.HOOK_FILE, 'utf8') : null;
    const prevScript = fs.existsSync(hooks.HOOK_SCRIPT)
      ? fs.readFileSync(hooks.HOOK_SCRIPT, 'utf8')
      : null;
    try {
      const p = hooks.installHooks();
      assert.equal(path.basename(p), 'pet.json');
      assert.ok(fs.existsSync(hooks.HOOK_SCRIPT), 'pet-state.js must be installed');
      assert.ok(fs.existsSync(hooks.HOOK_SH_RUNNER), 'pet-run.sh must be installed');
      const written = JSON.parse(fs.readFileSync(p, 'utf8'));
      const h = written.hooks.UserPromptSubmit[0].hooks[0];
      assert.equal(h.type, 'command');
      assert.equal(h.async, true);
      assert.match(String(h.command), /pet-state\.js/);
      assert.match(String(h.command), /thinking/);
      // Absolute path — not relative ./pet-run.sh
      assert.doesNotMatch(String(h.command), /^\.\/pet-run/);
      assert.ok(written.hooks.PreToolUse);
      assert.ok(written.hooks.Stop);
    } finally {
      if (prev != null) fs.writeFileSync(hooks.HOOK_FILE, prev, 'utf8');
      else if (hooks.isInstalled()) fs.unlinkSync(hooks.HOOK_FILE);
      if (prevScript != null) fs.writeFileSync(hooks.HOOK_SCRIPT, prevScript, 'utf8');
    }
  });
});

describe('parseStateBody (real shipped parser)', () => {
  it('accepts plain-text states', () => {
    for (const s of ['thinking', 'working', 'done', 'wake', 'idle', 'sleep', 'alert', 'click']) {
      assert.equal(parseStateBody(s), s);
    }
    assert.equal(parseStateBody('weee'), 'click');
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
  let showCalls = 0;

  before(async () => {
    showCalls = 0;
    server = await startStateServer((s) => received.push(s), {
      port: 0,
      onShow: () => {
        showCalls += 1;
      },
    });
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

  it('POST /show invokes onShow without changing pet state', async () => {
    received.length = 0;
    showCalls = 0;
    const before = server.getLastState();
    const r = await post(port, '/show', '');
    assert.equal(r.status, 200);
    assert.match(r.body, /"shown"\s*:\s*true/);
    assert.equal(showCalls, 1);
    assert.equal(server.getLastState(), before);
    assert.deepEqual(received, []);
  });

  it('POST /hook with Grok event JSON maps to pet states (shipped HTTP hook path)', async () => {
    received.length = 0;
    const r1 = await postGrokHttpHook(port, 'user_prompt_submit');
    assert.equal(r1.status, 200);
    assert.equal(r1.body, 'thinking');
    const r2 = await postGrokHttpHook(port, 'pre_tool_use');
    assert.equal(r2.body, 'working');
    const r3 = await postGrokHttpHook(port, 'stop');
    assert.equal(r3.body, 'done');
    assert.deepEqual(received, ['thinking', 'working', 'done']);
  });

  it('POST /hook accepts PascalCase hookEventName from Grok variants', async () => {
    received.length = 0;
    await postGrokHttpHook(port, 'UserPromptSubmit');
    await postGrokHttpHook(port, 'PreToolUse');
    await postGrokHttpHook(port, 'Stop');
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

  it('rejects browser Origin header (drive-by)', async () => {
    received.length = 0;
    const r = await post(port, '/state', 'thinking', 'text/plain', {
      Origin: 'https://evil.example',
    });
    assert.equal(r.status, 403);
    assert.deepEqual(received, []);
  });

  it('rejects oversized POST body with 413', async () => {
    received.length = 0;
    const big = 'x'.repeat(5000);
    const r = await post(port, '/state', big);
    assert.equal(r.status, 413);
    assert.deepEqual(received, []);
  });

  it('isLoopback uses an exact allow-list', () => {
    const { isLoopback } = require('../main/state-server');
    assert.equal(isLoopback('127.0.0.1'), true);
    assert.equal(isLoopback('::1'), true);
    assert.equal(isLoopback('::ffff:127.0.0.1'), true);
    assert.equal(isLoopback('10.0.0.1'), false);
    assert.equal(isLoopback('evil127.0.0.1'), false);
    assert.equal(isLoopback('192.168.1.127.0.0.1'), false);
  });

  it('setState applies allowed states and rejects invalid ones', async () => {
    received.length = 0;
    assert.equal(server.setState('alert'), 'alert');
    assert.equal(server.getLastState(), 'alert');
    assert.deepEqual(received, ['alert']);
    assert.equal(server.setState('not-a-state'), null);
    assert.equal(server.getLastState(), 'alert');
    assert.deepEqual(received, ['alert']);
    assert.equal(server.setState('  SLEEP  '), 'sleep');
    assert.equal(server.getLastState(), 'sleep');
    assert.deepEqual(received, ['alert', 'sleep']);
  });

  it('accepts click / WEEEE alias and setState emit:false skips onState', async () => {
    received.length = 0;
    const r = await post(port, '/state', 'weee');
    assert.equal(r.status, 200);
    assert.equal(r.body, 'click');
    assert.deepEqual(received, ['click']);

    received.length = 0;
    assert.equal(server.setState('click', { emit: false }), 'click');
    assert.equal(server.getLastState(), 'click');
    assert.deepEqual(received, []);
  });
});

describe('installed HTTP hook chain (thinking → working → done)', () => {
  let server;
  /** @type {string[]} */
  const received = [];

  before(async () => {
    // Prefer fixed port 7788 like production; skip if busy and use ephemeral + rewrite URL in posts
    try {
      server = await startStateServer((s) => received.push(s), { port: 7788 });
    } catch {
      server = await startStateServer((s) => received.push(s), { port: 0 });
    }
  });

  after(async () => {
    if (server) await server.close();
  });

  it('drives onState via real /hook envelope matching installHooks URL path', async () => {
    received.length = 0;
    const port = server.server.address().port;
    // Exact path from getHookUrl / makeHooksPayload
    assert.match(hooks.getHookUrl(), /\/hook$/);

    const sequence = [
      ['user_prompt_submit', 'thinking'],
      ['pre_tool_use', 'working'],
      ['stop', 'done'],
    ];
    for (const [ev, expected] of sequence) {
      const r = await post(
        port,
        '/hook',
        JSON.stringify({ hookEventName: ev, sessionId: 'chain' }),
        'application/json'
      );
      assert.equal(r.status, 200, `failed for ${ev}: ${r.body}`);
      assert.equal(r.body, expected);
    }
    assert.deepEqual(received, ['thinking', 'working', 'done']);
    assert.equal(server.getLastState(), 'done');
    const health = JSON.parse((await get(port, '/health')).body);
    const states = health.history.map((h) => h.state);
    assert.ok(states.includes('thinking'));
    assert.ok(states.includes('working'));
    assert.ok(states.includes('done'));
  });
});

describe('pet-state-hook.js (real Grok hook script)', () => {
  let server;
  /** @type {string[]} */
  const received = [];
  let scriptCopy;

  before(async () => {
    try {
      server = await startStateServer((s) => received.push(s), { port: 7788 });
    } catch {
      server = null;
    }
    scriptCopy = path.join(__dirname, '..', 'main', 'pet-state-hook.js');
  });

  after(async () => {
    if (server) await server.close();
  });

  it('posts thinking with stdin JSON present and exits 0', async () => {
    if (!server) {
      // Port held by live pet — still exercise script against live server
      const r = await runHookScript('thinking', scriptCopy);
      assert.equal(r.code, 0, `hook script failed: ${r.err}`);
      const h = await get(7788, '/health');
      assert.equal(JSON.parse(h.body).lastState, 'thinking');
      return;
    }
    received.length = 0;
    const r = await runHookScript('thinking', scriptCopy);
    assert.equal(r.code, 0, `hook script failed: ${r.err}`);
    assert.ok(received.includes('thinking'));
  });

  it('posts working and done in sequence', async () => {
    if (!server) {
      for (const s of ['working', 'done']) {
        const r = await runHookScript(s, scriptCopy);
        assert.equal(r.code, 0, `failed on ${s}: ${r.err}`);
      }
      const h = await get(7788, '/health');
      assert.equal(JSON.parse(h.body).lastState, 'done');
      return;
    }
    for (const s of ['working', 'done']) {
      const r = await runHookScript(s, scriptCopy);
      assert.equal(r.code, 0, `failed on ${s}: ${r.err}`);
    }
    assert.equal(server.getLastState(), 'done');
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
  });

  it('exposes consistent tray / chrome flags', () => {
    assert.equal(typeof platform.trayOpensOnClick(), 'boolean');
    assert.ok(Array.isArray(platform.trayIconCandidates()));
    assert.ok(platform.trayIconCandidates().length > 0);
    assert.equal(typeof platform.restartHint(), 'string');
  });
});
