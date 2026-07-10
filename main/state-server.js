'use strict';

const http = require('http');

const HOST = '127.0.0.1';
const PORT = 7788;

const ALLOWED_STATES = new Set([
  'wake',
  'thinking',
  'working',
  'done',
  'alert',
  'sleep',
  'idle',
  /** Local click / WEEEE bounce (dashboard + manual testing; not a Grok hook). */
  'click',
]);

/** Friendly aliases accepted by parseStateBody / setState */
const STATE_ALIASES = {
  weee: 'click',
  whee: 'click',
  wooo: 'click',
};

/** Map Grok hook event names (PascalCase, snake_case, camelCase) → pet state */
const EVENT_TO_STATE = {
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
  permissiondenied: 'alert',
  permission_denied: 'alert',
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
  subagentend: 'working',
  subagent_end: 'working',
};

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Max POST body size (valid state payloads are tiny). */
const MAX_BODY_BYTES = 4096;

function isLoopback(addr) {
  if (!addr) return false;
  return LOOPBACK_ADDRS.has(addr);
}

/**
 * Browsers always send Origin on cross-origin fetches; hooks/curl do not.
 * Rejecting Origin blocks browser drive-by POSTs to the loopback control channel.
 * @param {import('http').IncomingMessage} req
 */
function isBrowserOrigin(req) {
  const origin = req.headers && req.headers.origin;
  return typeof origin === 'string' && origin.length > 0;
}

/**
 * Parse POST body into a pet state name, or null if invalid.
 * Accepts plain text, quoted text, JSON {state}, or Grok hook event JSON.
 */
function parseStateBody(raw, urlPath) {
  let body = String(raw || '').trim();

  if (!body && urlPath && urlPath.includes('state=')) {
    try {
      const q = new URL(urlPath, 'http://127.0.0.1').searchParams.get('state');
      if (q) body = q.trim();
    } catch {
      /* ignore */
    }
  }

  if (!body) return null;

  if (
    (body.startsWith("'") && body.endsWith("'")) ||
    (body.startsWith('"') && body.endsWith('"'))
  ) {
    body = body.slice(1, -1).trim();
  }

  const lower = body.toLowerCase();
  if (STATE_ALIASES[lower]) return STATE_ALIASES[lower];
  if (ALLOWED_STATES.has(lower)) return lower;

  if (body.startsWith('{')) {
    try {
      const j = JSON.parse(body);
      if (j && j.state && ALLOWED_STATES.has(String(j.state).toLowerCase())) {
        return String(j.state).toLowerCase();
      }
      const ev =
        j.hookEventName ||
        j.hook_event_name ||
        j.event ||
        j.eventName ||
        j.name ||
        '';
      const mapped = mapHookEventToState(ev);
      if (mapped) return mapped;
    } catch {
      /* ignore */
    }
  }

  const mapped = mapHookEventToState(body);
  if (mapped) return mapped;

  return null;
}

function mapHookEventToState(eventName) {
  if (!eventName) return null;
  const key = String(eventName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return EVENT_TO_STATE[key] || null;
}

/**
 * Tiny localhost state server.
 * @param {(state: string) => void} onState
 * @param {{ host?: string, port?: number, onShow?: () => void }} [opts]
 */
function startStateServer(onState, opts = {}) {
  const host = opts.host || HOST;
  const port = opts.port != null ? opts.port : PORT;
  const onShow = typeof opts.onShow === 'function' ? opts.onShow : null;

  let lastState = 'idle';
  let lastAt = Date.now();
  /** @type {{ state: string, at: number }[]} */
  const history = [];

  function applyState(state) {
    lastState = state;
    lastAt = Date.now();
    history.push({ state, at: lastAt });
    if (history.length > 50) history.shift();
    try {
      onState(state);
    } catch (err) {
      console.error('[state-server] onState error', err);
    }
  }

  const server = http.createServer((req, res) => {
    const remote = req.socket.remoteAddress;
    if (!isLoopback(remote)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden');
      return;
    }

    // Browsers send Origin; hooks/curl never do. Block drive-by POSTs/GETs.
    if (isBrowserOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden origin');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || '/';

    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          lastState,
          lastAt,
          pid: process.pid,
          history: history.slice(-12),
        })
      );
      return;
    }

    if (req.method === 'GET' && url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ state: lastState, lastAt, history: history.slice(-12) }));
      return;
    }

    // Unhide pet overlay if the app process is already running (no-op if not)
    if (req.method === 'POST' && (url === '/show' || url.startsWith('/show?'))) {
      req.resume();
      req.on('end', () => {
        try {
          if (onShow) onShow();
        } catch (err) {
          console.error('[state-server] onShow error', err);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, shown: true }));
      });
      return;
    }

    // Plain-text state OR Grok HTTP hook envelope
    if (
      req.method === 'POST' &&
      (url === '/state' ||
        url.startsWith('/state?') ||
        url === '/hook' ||
        url.startsWith('/hook?') ||
        url === '/event' ||
        url.startsWith('/event?'))
    ) {
      const chunks = [];
      let total = 0;
      let tooLarge = false;
      req.on('data', (c) => {
        if (tooLarge) return;
        total += c.length;
        if (total > MAX_BODY_BYTES) {
          tooLarge = true;
          chunks.length = 0;
          if (!res.writableEnded && !res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('payload too large');
          }
          // Drain remaining data without buffering (do not destroy — keeps keep-alive healthy)
          req.resume();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooLarge || res.writableEnded || res.headersSent) return;
        const raw = Buffer.concat(chunks).toString('utf8');
        const state = parseStateBody(raw, url);
        if (!state) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`unknown state: ${raw.slice(0, 80)}`);
          return;
        }
        applyState(state);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(state);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      console.error('[state-server] error', err.message);
      reject(err);
    });
    server.listen(port, host, () => {
      console.log(`[state-server] listening on http://${host}:${port} pid=${process.pid}`);
      resolve({
        server,
        host,
        port,
        getLastState: () => lastState,
        getHistory: () => history.slice(),
        /**
         * Manually set pet state (dashboard / tests). Same path as POST /state.
         * @param {string} state
         * @param {{ emit?: boolean }} [opts] emit=false updates history only (no onState)
         * @returns {string | null} applied state, or null if invalid
         */
        setState(state, opts = {}) {
          let s = String(state || '').trim().toLowerCase();
          if (STATE_ALIASES[s]) s = STATE_ALIASES[s];
          if (!ALLOWED_STATES.has(s)) return null;
          if (opts.emit === false) {
            lastState = s;
            lastAt = Date.now();
            history.push({ state: s, at: lastAt });
            if (history.length > 50) history.shift();
            return s;
          }
          applyState(s);
          return s;
        },
        close() {
          return new Promise((resClose) => {
            server.close(() => resClose());
          });
        },
      });
    });
  });
}

module.exports = {
  HOST,
  PORT,
  MAX_BODY_BYTES,
  ALLOWED_STATES,
  STATE_ALIASES,
  EVENT_TO_STATE,
  parseStateBody,
  mapHookEventToState,
  startStateServer,
  isLoopback,
  isBrowserOrigin,
};
