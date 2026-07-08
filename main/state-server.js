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
]);

/** Map Grok hook event names (PascalCase, snake_case, camelCase) → pet state */
const EVENT_TO_STATE = {
  sessionstart: 'wake',
  session_start: 'wake',
  userpromptsubmit: 'thinking',
  user_prompt_submit: 'thinking',
  beforesubmitprompt: 'thinking',
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
  subagentend: 'working',
};

function isLoopback(addr) {
  if (!addr) return false;
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.endsWith('127.0.0.1')
  );
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
 * @param {{ host?: string, port?: number }} [opts]
 */
function startStateServer(onState, opts = {}) {
  const host = opts.host || HOST;
  const port = opts.port != null ? opts.port : PORT;

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
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
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
  ALLOWED_STATES,
  EVENT_TO_STATE,
  parseStateBody,
  mapHookEventToState,
  startStateServer,
  isLoopback,
};
