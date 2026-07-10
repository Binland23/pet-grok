'use strict';
/**
 * Grok command-hook helper. Installed to ~/.grok/hooks/pet-state.js
 * Usage: node pet-state.js <state>
 *
 * - Drains stdin (Grok sends event JSON; we must not block on it)
 * - POSTs plain-text state to 127.0.0.1:7788/state
 * - Prints {"decision":"allow"} for PreToolUse so blocking hooks stay green
 * - Exits 0 on HTTP 200 so hooks stay fail-open cleanly
 *
 * Prefer this over type:"http" to localhost — Grok SSRF-blocks loopback HTTP hooks.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEBUG_LOG = path.join(os.homedir(), '.grok', 'hooks', 'pet-state.debug.log');
const DEBUG_ENABLED = /^(1|true|yes)$/i.test(String(process.env.PET_GROK_DEBUG_LOGS || ''));
const MAX_DEBUG_BYTES = 256 * 1024;
const KEEP_DEBUG_BYTES = 192 * 1024;
let debugWrites = Promise.resolve();

function dbg(msg) {
  if (!DEBUG_ENABLED) return Promise.resolve();
  const line =
    new Date().toISOString() +
    ' ' +
    msg +
    ' argv=' +
    JSON.stringify(process.argv) +
    ' GROK_HOOK_EVENT=' +
    String(process.env.GROK_HOOK_EVENT || '') +
    '\n';
  debugWrites = debugWrites
    .then(async () => {
      await fs.promises.mkdir(path.dirname(DEBUG_LOG), { recursive: true });
      await fs.promises.appendFile(DEBUG_LOG, line, 'utf8');
      const stat = await fs.promises.stat(DEBUG_LOG);
      if (stat.size <= MAX_DEBUG_BYTES) return;
      const data = await fs.promises.readFile(DEBUG_LOG);
      await fs.promises.writeFile(
        DEBUG_LOG,
        data.subarray(Math.max(0, data.length - KEEP_DEBUG_BYTES))
      );
    })
    .catch(() => {});
  return debugWrites;
}

/**
 * Resolve pet state from argv, GROK_HOOK_EVENT, or stdin envelope.
 */
function stateFromHookEvent(ev) {
  if (!ev) return '';
  const key = String(ev)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  const map = {
    sessionstart: 'wake',
    session_start: 'wake',
    userpromptsubmit: 'thinking',
    user_prompt_submit: 'thinking',
    beforesubmitprompt: 'thinking',
    before_submit_prompt: 'thinking',
    pretooluse: 'working',
    pre_tool_use: 'working',
    posttooluse: 'working',
    post_tool_use: 'working',
    posttoolusefailure: 'alert',
    post_tool_use_failure: 'alert',
    stop: 'done',
    stopfailure: 'alert',
    stop_failure: 'alert',
    notification: 'alert',
    sessionend: 'sleep',
    session_end: 'sleep',
    subagentstart: 'working',
    subagent_start: 'working',
    subagentstop: 'working',
    subagent_stop: 'working',
  };
  return map[key] || '';
}

let state = String(process.argv[2] || '')
  .trim()
  .toLowerCase();
if (!state) {
  state = stateFromHookEvent(process.env.GROK_HOOK_EVENT || '');
}

// Drain stdin without waiting for EOF; optionally recover state from envelope
try {
  if (process.stdin && process.stdin.readable) {
    process.stdin.resume();
    process.stdin.on('data', (chunk) => {
      if (state) return;
      try {
        const j = JSON.parse(String(chunk));
        const ev = j.hookEventName || j.hook_event_name || j.event || '';
        const mapped = stateFromHookEvent(ev);
        if (mapped) state = mapped;
      } catch {
        /* ignore partial/non-json */
      }
    });
    if (typeof process.stdin.unref === 'function') process.stdin.unref();
  }
} catch (e) {
  dbg('stdin setup ' + e.message);
}

// Brief settle so a first stdin chunk can fill state when argv is missing
function startPost() {
  if (!state) {
    dbg('missing state arg and GROK_HOOK_EVENT');
    process.stderr.write('usage: pet-state.js <state>\n');
    process.exit(2);
  }

  // PreToolUse can block; always allow so the pet never stalls the agent.
  try {
    process.stdout.write('{"decision":"allow"}\n');
  } catch {
    /* ignore */
  }

  /**
   * POST plain text to a path; resolve with status or 0 on network error (fail-open).
   * @param {string} pathName
   * @param {string} bodyText
   */
  function post(pathName, bodyText) {
    return new Promise((resolve) => {
      const bodyBuf = Buffer.from(bodyText || '', 'utf8');
      const req = http.request(
        {
          host: '127.0.0.1',
          port: 7788,
          path: pathName,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'Content-Length': bodyBuf.length,
          },
          timeout: 4000,
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode || 0));
        }
      );
      req.on('error', (e) => {
        dbg('request error ' + pathName + ' ' + (e && e.message));
        resolve(0);
      });
      req.on('timeout', () => {
        dbg('timeout ' + pathName + ' state=' + state);
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        resolve(0);
      });
      req.end(bodyBuf);
    });
  }

  (async () => {
    const status = await post('/state', state);
    await dbg('ok status=' + status + ' state=' + state);
    // SessionStart → wake: also hit /show so a running-but-hidden pet reappears
    if (state === 'wake') {
      const showStatus = await post('/show', '');
      await dbg('show status=' + showStatus);
    }
    // Fail-open: exit 0 even if pet app is not running
    process.exit(0);
  })();
}

// If state already known from argv/env, post immediately; else wait briefly for stdin
if (state) {
  startPost();
} else {
  setTimeout(startPost, 50);
}
