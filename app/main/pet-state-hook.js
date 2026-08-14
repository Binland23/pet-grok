'use strict';
/**
 * Grok command-hook helper. Installed to ~/.grok/hooks/pet-state.js
 * Usage: node pet-state.js <state>
 *
 * - Reads stdin event JSON (Grok sends toolName / toolInput / prompt, etc.)
 * - POSTs state (+ optional detail summary) to 127.0.0.1:7788/state
 * - Prints {"decision":"allow"} for PreToolUse so blocking hooks stay green
 * - Exits 0 on success or network error so hooks stay fail-open cleanly
 *
 * Prefer this over type:"http" to localhost — Grok SSRF-blocks loopback HTTP hooks.
 *
 * Installed next to activity-summary.js (copied by Refresh hooks). That sibling
 * is the only extra require — no app/ modules. Refresh hooks after upgrading.
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
const STDIN_MAX = 8192;

/** @type {(envelope: unknown) => string} */
let summarizeHookDetail = function summarizeHookDetailFallback() {
  return '';
};
try {
  ({ summarizeHookDetail } = require('./activity-summary'));
} catch {
  /* older installs without the sibling still post the pose name */
}

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
    permissiondenied: 'alert',
    permission_denied: 'alert',
    // Bare notification → idle; type-specific mapping in stateFromNotification
    notification: 'idle',
    sessionend: 'sleep',
    session_end: 'sleep',
    subagentstart: 'working',
    subagent_start: 'working',
    subagentstop: 'working',
    subagent_stop: 'working',
    subagentend: 'working',
    subagent_end: 'working',
  };
  return map[key] || '';
}

function normalizeEventKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

function isNotificationEvent(envelope, hookEventEnv) {
  if (normalizeEventKey(hookEventEnv) === 'notification') return true;
  if (!envelope || typeof envelope !== 'object') return false;
  const ev = normalizeEventKey(
    envelope.hookEventName ||
      envelope.hook_event_name ||
      envelope.event ||
      envelope.eventName ||
      envelope.name ||
      ''
  );
  return ev === 'notification';
}

/**
 * Grok Notification is often "turn complete" (not an emergency). Only map
 * approval / error-ish types to alert; everything else → idle.
 * @param {Record<string, unknown> | null} envelope
 * @returns {'alert' | 'idle'}
 */
function stateFromNotification(envelope) {
  const j = envelope && typeof envelope === 'object' ? envelope : {};
  const type = normalizeEventKey(
    j.notificationType ||
      j.notification_type ||
      j.type ||
      j.notification ||
      process.env.GROK_EVENT ||
      j.event ||
      ''
  );
  const typeKey = type === 'notification' ? '' : type;

  if (/approval|permission|actionrequired|needs?input|auth|confirm|waiting/.test(typeKey)) {
    return 'alert';
  }
  if (/error|fail|denied/.test(typeKey)) {
    return 'alert';
  }
  if (
    /turncomplete|taskcomplete|sessionready|complete|idle|done|success|finished|ready/.test(
      typeKey
    )
  ) {
    return 'idle';
  }

  const msg = String(j.message || j.GROK_MESSAGE || process.env.GROK_MESSAGE || j.title || j.body || '').toLowerCase();
  if (/approval|permission|waiting for you|needs? your|confirm|action required/.test(msg)) {
    return 'alert';
  }
  if (/\berror\b|failed|failure/.test(msg)) {
    return 'alert';
  }
  if (/complete|finished|done|ready|turn ended|response ready/.test(msg)) {
    return 'idle';
  }
  return 'idle';
}

/**
 * Buffer stdin until EOF or a short settle window (Grok may not close stdin promptly).
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(raw);
    };
    try {
      if (!process.stdin || !process.stdin.readable) {
        finish();
        return;
      }
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        if (raw.length >= STDIN_MAX) return;
        raw += String(chunk);
        if (raw.length > STDIN_MAX) raw = raw.slice(0, STDIN_MAX);
      });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
      // Settle quickly: argv has the pose; stdin carries the tool envelope
      setTimeout(finish, 200);
      if (typeof process.stdin.unref === 'function') process.stdin.unref();
    } catch (e) {
      dbg('stdin setup ' + (e && e.message));
      finish();
    }
  });
}

/**
 * POST body to a path; resolve with status or 0 on network error (fail-open).
 * @param {string} pathName
 * @param {string} bodyText
 * @param {string} [contentType]
 */
function post(pathName, bodyText, contentType) {
  return new Promise((resolve) => {
    const bodyBuf = Buffer.from(bodyText || '', 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 7788,
        path: pathName,
        method: 'POST',
        headers: {
          'Content-Type': contentType || 'text/plain',
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
      dbg('timeout ' + pathName);
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

async function main() {
  let state = String(process.argv[2] || '')
    .trim()
    .toLowerCase();
  if (!state) {
    state = stateFromHookEvent(process.env.GROK_HOOK_EVENT || '');
  }

  const stdinRaw = await readStdin();
  /** @type {Record<string, unknown> | null} */
  let envelope = null;
  if (stdinRaw && stdinRaw.trim().startsWith('{')) {
    try {
      envelope = JSON.parse(stdinRaw.trim());
    } catch {
      envelope = null;
    }
  }

  if (!state && envelope) {
    const ev =
      envelope.hookEventName ||
      envelope.hook_event_name ||
      envelope.event ||
      '';
    state = stateFromHookEvent(ev);
  }

  // Notification lifecycle: always re-resolve from type.
  // Older pet.json installs hardcode argv "alert" for every Notification —
  // that wrongly leaves the pet stuck after turn_complete pings.
  const hookEv = process.env.GROK_HOOK_EVENT || '';
  if (isNotificationEvent(envelope, hookEv) || (state === 'alert' && normalizeEventKey(hookEv) === 'notification')) {
    state = stateFromNotification(envelope);
    dbg('notification remapped to state=' + state);
  }

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

  const detail = summarizeHookDetail(envelope);
  let status;
  if (detail) {
    status = await post(
      '/state',
      JSON.stringify({ state, detail }),
      'application/json'
    );
  } else {
    status = await post('/state', state, 'text/plain');
  }
  dbg('ok status=' + status + ' state=' + state + (detail ? ' detail=' + detail : ''));

  // SessionStart → wake: also hit /show so a running-but-hidden pet reappears
  if (state === 'wake') {
    const showStatus = await post('/show', '');
    dbg('show status=' + showStatus);
  }
  // SessionEnd → sleep: hide the overlay (terminal/session is over; tray stays)
  if (state === 'sleep') {
    const hideStatus = await post('/hide', '');
    dbg('hide status=' + hideStatus);
  }
  // Fail-open: exit 0 even if pet app is not running
  process.exit(0);
}

main().catch((err) => {
  dbg('main error ' + (err && err.message));
  process.exit(0);
});
