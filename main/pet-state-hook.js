'use strict';
/**
 * Grok command-hook helper. Installed to ~/.grok/hooks/pet-state.js
 * Usage: node pet-state.js <state>
 *
 * - Ignores stdin (Grok sends event JSON on stdin; we must not block on it)
 * - POSTs plain-text state to 127.0.0.1:7788/state
 * - Exits 0 on HTTP 200 so hooks stay fail-open cleanly
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEBUG_LOG = path.join(os.homedir(), '.grok', 'hooks', 'pet-state.debug.log');

function dbg(msg) {
  try {
    fs.appendFileSync(
      DEBUG_LOG,
      new Date().toISOString() + ' ' + msg + ' argv=' + JSON.stringify(process.argv) + '\n',
      'utf8'
    );
  } catch {
    /* ignore */
  }
}

/**
 * Resolve pet state from argv, or from Grok's GROK_HOOK_EVENT when spawned
 * without an explicit state (HTTP is preferred; this is command fallback).
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
    pretooluse: 'working',
    pre_tool_use: 'working',
    posttooluse: 'working',
    post_tool_use: 'working',
    posttoolusefailure: 'alert',
    post_tool_use_failure: 'alert',
    stop: 'done',
    notification: 'alert',
    sessionend: 'sleep',
    session_end: 'sleep',
  };
  return map[key] || '';
}

let state = String(process.argv[2] || '')
  .trim()
  .toLowerCase();
if (!state) {
  state = stateFromHookEvent(process.env.GROK_HOOK_EVENT || '');
}

if (!state) {
  dbg('missing state arg and GROK_HOOK_EVENT');
  process.stderr.write('usage: pet-state.js <state>\n');
  process.exit(2);
}

// Drain stdin without ever waiting for EOF (Grok may keep the pipe open)
try {
  if (process.stdin && process.stdin.readable) {
    process.stdin.resume();
    process.stdin.on('data', () => {});
    if (typeof process.stdin.unref === 'function') process.stdin.unref();
  }
} catch (e) {
  dbg('stdin setup ' + e.message);
}

const body = state;
const req = http.request(
  {
    host: '127.0.0.1',
    port: 7788,
    path: '/state',
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: 4000,
  },
  (res) => {
    res.resume();
    res.on('end', () => {
      dbg('ok status=' + res.statusCode + ' state=' + state);
      process.exit(res.statusCode === 200 ? 0 : 1);
    });
  }
);

req.on('error', (e) => {
  dbg('request error ' + (e && e.message));
  process.exit(1);
});
req.on('timeout', () => {
  dbg('timeout state=' + state);
  try {
    req.destroy();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
req.end(body);
