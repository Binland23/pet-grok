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
  /**
   * Bare "notification" without a type defaults to idle.
   * Grok fires Notification for turn_complete (often ~1 min after Stop when
   * the terminal is unfocused) — that is NOT an alert. Real attention events
   * are resolved via stateFromNotification().
   */
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

const DETAIL_MAX = 64;

/**
 * Collapse whitespace, redact obvious secrets, truncate for the bubble.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function sanitizeDetailText(value, max = DETAIL_MAX) {
  let s = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  // Light fail-open redaction of common secret-looking tokens
  s = s
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-…')
    .replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{12,}\b/gi, 'Bearer …')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, (m) => (m.length > 48 ? `${m.slice(0, 8)}…` : m));
  if (s.length > max) s = s.slice(0, Math.max(0, max - 1)) + '…';
  return s;
}

/**
 * @param {unknown} toolName
 * @returns {string} normalized tool key
 */
function toolKey(toolName) {
  const raw = String(toolName || '').trim();
  if (!raw) return '';
  const base = raw.includes('__') ? raw.split('__').pop() : raw;
  return String(base)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Short path/file label for messages.
 * @param {unknown} value
 * @returns {string}
 */
function shortPath(value) {
  let v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (/[/\\]/.test(v)) {
    const parts = v.split(/[/\\]/).filter(Boolean);
    if (parts.length > 1) v = parts.slice(-2).join('/');
  }
  return sanitizeDetailText(v, 28);
}

/**
 * Shorten a shell command for the bubble (first meaningful token + hint).
 * @param {unknown} command
 * @returns {string}
 */
function shortCommand(command) {
  let c = String(command == null ? '' : command)
    .replace(/\s+/g, ' ')
    .trim();
  if (!c) return '';
  // Drop common prefixes
  c = c.replace(/^(sudo|env|npx|npm exec)\s+/i, '');
  if (c.length <= 28) return sanitizeDetailText(c, 28);
  return sanitizeDetailText(c, 28);
}

/**
 * @param {unknown} toolName
 * @returns {string}
 */
function humanizeToolName(toolName) {
  const key = toolKey(toolName);
  const labels = {
    run_terminal_command: 'Terminal',
    bash: 'Terminal',
    shell: 'Terminal',
    shell_command: 'Terminal',
    read_file: 'Read',
    read: 'Read',
    search_replace: 'Edit',
    edit: 'Edit',
    write: 'Write',
    write_file: 'Write',
    multiedit: 'Edit',
    grep: 'Search',
    glob: 'Find',
    list_dir: 'List',
    listdir: 'List',
    web_search: 'Web',
    websearch: 'Web',
    web_fetch: 'Fetch',
    open_page: 'Fetch',
    spawn_subagent: 'Subagent',
    task: 'Subagent',
    todo_write: 'Todos',
    image_gen: 'Image',
    image_edit: 'Image',
  };
  if (labels[key]) return labels[key];
  const raw = String(toolName || '').trim();
  if (!raw) return '';
  const base = raw.includes('__') ? raw.split('__').pop() : raw;
  const spaced = String(base)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return sanitizeDetailText(raw, 24);
  return spaced
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * @param {unknown} toolInput
 * @param {string} key
 * @returns {string}
 */
function inputField(toolInput, key) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const o = /** @type {Record<string, unknown>} */ (toolInput);
  if (o[key] == null || !String(o[key]).trim()) return '';
  return String(o[key]).trim();
}

/**
 * Build a plain-language activity line for the status bubble.
 * Prefer short readable sentences over raw tool · path dumps.
 * @param {unknown} envelope
 * @returns {string} empty if nothing useful
 */
function summarizeHookDetail(envelope) {
  if (!envelope || typeof envelope !== 'object') return '';
  const j = /** @type {Record<string, unknown>} */ (envelope);

  // Explicit detail from tests / pre-formatted payloads
  if (j.detail != null && String(j.detail).trim()) {
    return sanitizeDetailText(j.detail);
  }

  const toolName = j.toolName || j.tool_name || j.tool || '';
  const toolInput = j.toolInput || j.tool_input || j.input || null;
  if (toolName) {
    const key = toolKey(toolName);
    const file =
      shortPath(
        inputField(toolInput, 'target_file') ||
          inputField(toolInput, 'file_path') ||
          inputField(toolInput, 'path')
      ) || '';
    const cmd = shortCommand(inputField(toolInput, 'command'));
    const query = sanitizeDetailText(
      inputField(toolInput, 'query') || inputField(toolInput, 'pattern') || '',
      24
    );
    const desc = sanitizeDetailText(inputField(toolInput, 'description') || '', 32);

    if (
      key === 'run_terminal_command' ||
      key === 'bash' ||
      key === 'shell' ||
      key === 'shell_command'
    ) {
      return cmd ? sanitizeDetailText(`Running ${cmd}`) : 'Running a command';
    }
    if (key === 'read_file' || key === 'read') {
      return file ? sanitizeDetailText(`Reading ${file}`) : 'Reading a file';
    }
    if (key === 'search_replace' || key === 'edit' || key === 'multiedit') {
      return file ? sanitizeDetailText(`Editing ${file}`) : 'Editing code';
    }
    if (key === 'write' || key === 'write_file') {
      return file ? sanitizeDetailText(`Writing ${file}`) : 'Writing a file';
    }
    if (key === 'grep') {
      return query ? sanitizeDetailText(`Searching for ${query}`) : 'Searching the codebase';
    }
    if (key === 'glob') {
      return query ? sanitizeDetailText(`Finding ${query}`) : 'Finding files';
    }
    if (key === 'list_dir' || key === 'listdir') {
      return file ? sanitizeDetailText(`Browsing ${file}`) : 'Browsing files';
    }
    if (key === 'web_search' || key === 'websearch') {
      return query ? sanitizeDetailText(`Web search: ${query}`) : 'Searching the web';
    }
    if (key === 'web_fetch' || key === 'open_page') {
      return 'Fetching a page';
    }
    if (key === 'spawn_subagent' || key === 'task') {
      return desc ? sanitizeDetailText(`Helper: ${desc}`) : 'Starting a helper agent';
    }
    if (key === 'todo_write') {
      return 'Updating the task list';
    }
    if (key === 'image_gen' || key === 'image_edit') {
      return 'Working on an image';
    }
    // MCP / unknown tools — still a sentence
    const label = humanizeToolName(toolName);
    if (file) return sanitizeDetailText(`Using ${label} on ${file}`);
    if (label) return sanitizeDetailText(`Using ${label}`);
  }

  const prompt = j.prompt || j.userPrompt || j.user_prompt || j.message || '';
  if (prompt && String(prompt).trim()) {
    let p = String(prompt)
      .replace(/<\/?user_query>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (p.length > 40) p = p.slice(0, 39) + '…';
    return p ? sanitizeDetailText(`On: ${p}`) : 'Thinking about your request';
  }

  // State-only fallbacks when envelope carries a state name
  const st = String(j.state || '')
    .trim()
    .toLowerCase();
  if (st === 'thinking') return 'Thinking it through…';
  if (st === 'working') return 'Getting things done…';
  if (st === 'done') return 'All done!';
  if (st === 'alert') return 'Needs your attention';

  return '';
}

/** @deprecated kept for tests / callers that only need a short path-ish target */
function pickToolTarget(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const o = /** @type {Record<string, unknown>} */ (toolInput);
  const keys = [
    'command',
    'target_file',
    'file_path',
    'path',
    'query',
    'url',
    'pattern',
    'prompt',
    'description',
  ];
  for (const k of keys) {
    if (o[k] != null && String(o[k]).trim()) {
      if (k === 'command') return shortCommand(o[k]);
      if (k === 'target_file' || k === 'file_path' || k === 'path') return shortPath(o[k]);
      return sanitizeDetailText(o[k], 36);
    }
  }
  return '';
}

/**
 * Parse POST body into { state, detail } or null if invalid.
 * Accepts plain text, quoted text, JSON {state, detail?}, or Grok hook event JSON.
 * @param {unknown} raw
 * @param {string} [urlPath]
 * @returns {{ state: string, detail: string } | null}
 */
function parseStatePayload(raw, urlPath) {
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
  if (STATE_ALIASES[lower]) return { state: STATE_ALIASES[lower], detail: '' };
  if (ALLOWED_STATES.has(lower)) return { state: lower, detail: '' };

  if (body.startsWith('{')) {
    try {
      const j = JSON.parse(body);
      if (!j || typeof j !== 'object') return null;

      let state = null;
      // Notification envelopes: always resolve from type (do not trust a stale
      // "alert" state field from older hook scripts that hardcoded argv alert).
      if (isNotificationEvent(j)) {
        state = stateFromNotification(j);
      } else if (j.state != null) {
        let s = String(j.state).trim().toLowerCase();
        if (STATE_ALIASES[s]) s = STATE_ALIASES[s];
        if (ALLOWED_STATES.has(s)) state = s;
      }
      if (!state) {
        const ev =
          j.hookEventName ||
          j.hook_event_name ||
          j.event ||
          j.eventName ||
          j.name ||
          '';
        state = mapHookEventToState(ev);
      }
      if (!state) return null;
      return { state, detail: summarizeHookDetail(j) };
    } catch {
      /* ignore */
    }
  }

  const mapped = mapHookEventToState(body);
  if (mapped) return { state: mapped, detail: '' };

  return null;
}

/**
 * Parse POST body into a pet state name, or null if invalid.
 * @param {unknown} raw
 * @param {string} [urlPath]
 * @returns {string | null}
 */
function parseStateBody(raw, urlPath) {
  const p = parseStatePayload(raw, urlPath);
  return p ? p.state : null;
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
 * Normalize a hook / notification type token for matching.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeEventKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * True when this envelope / env is a Grok Notification lifecycle event.
 * @param {Record<string, unknown> | null | undefined} envelope
 * @param {string} [hookEventEnv]
 */
function isNotificationEvent(envelope, hookEventEnv) {
  const fromEnv = normalizeEventKey(hookEventEnv);
  if (fromEnv === 'notification') return true;
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
 * Map a Grok Notification payload to a pet state.
 *
 * Grok's Notification hook fires for several UI events (see ui.notifications):
 *   turn_complete, task_complete, session_ready  → idle (not alert!)
 *   approval_required / permission prompts       → alert
 *   agent_error                                  → alert
 *
 * Older pet hooks hardcode argv "alert" for every Notification — callers
 * should re-resolve with this helper so turn_complete doesn't stick on alert.
 *
 * @param {Record<string, unknown> | null | undefined} envelope
 * @param {{ envEvent?: string, message?: string }} [opts]
 * @returns {'alert' | 'idle'}
 */
function stateFromNotification(envelope, opts = {}) {
  const j = envelope && typeof envelope === 'object' ? envelope : {};
  const type = normalizeEventKey(
    j.notificationType ||
      j.notification_type ||
      j.type ||
      j.notification ||
      opts.envEvent ||
      j.event ||
      ''
  );
  // Avoid treating the lifecycle event name itself as a type
  const typeKey = type === 'notification' ? '' : type;

  if (
    /approval|permission|actionrequired|needs?input|auth|confirm|waiting/.test(typeKey)
  ) {
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

  const msg = String(
    j.message || j.GROK_MESSAGE || opts.message || j.title || j.body || ''
  ).toLowerCase();
  if (/approval|permission|waiting for you|needs? your|confirm|action required/.test(msg)) {
    return 'alert';
  }
  if (/\berror\b|failed|failure/.test(msg)) {
    return 'alert';
  }
  if (/complete|finished|done|ready|turn ended|response ready/.test(msg)) {
    return 'idle';
  }

  // Safe default: Notification is usually "turn finished / ping", not an emergency
  return 'idle';
}

/**
 * Tiny localhost state server.
 * @param {(state: string, meta?: { detail?: string }) => void} onState
 * @param {{ host?: string, port?: number, onShow?: () => void }} [opts]
 */
function startStateServer(onState, opts = {}) {
  const host = opts.host || HOST;
  const port = opts.port != null ? opts.port : PORT;
  const onShow = typeof opts.onShow === 'function' ? opts.onShow : null;

  let lastState = 'idle';
  let lastDetail = '';
  let lastAt = Date.now();
  /** @type {{ state: string, detail?: string, at: number }[]} */
  const history = [];

  /**
   * @param {string} state
   * @param {{ detail?: string }} [meta]
   */
  function applyState(state, meta = {}) {
    lastState = state;
    lastDetail = meta.detail ? String(meta.detail) : '';
    lastAt = Date.now();
    const entry = { state, at: lastAt };
    if (lastDetail) entry.detail = lastDetail;
    history.push(entry);
    if (history.length > 50) history.shift();
    try {
      onState(state, { detail: lastDetail || undefined });
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
          lastDetail: lastDetail || undefined,
          lastAt,
          pid: process.pid,
          history: history.slice(-12),
        })
      );
      return;
    }

    if (req.method === 'GET' && url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          state: lastState,
          detail: lastDetail || undefined,
          lastAt,
          history: history.slice(-12),
        })
      );
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
        const parsed = parseStatePayload(raw, url);
        if (!parsed) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`unknown state: ${raw.slice(0, 80)}`);
          return;
        }
        applyState(parsed.state, { detail: parsed.detail || '' });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(parsed.state);
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
        getLastDetail: () => lastDetail,
        getHistory: () => history.slice(),
        /**
         * Manually set pet state (dashboard / tests). Same path as POST /state.
         * @param {string} state
         * @param {{ emit?: boolean, detail?: string }} [opts] emit=false updates history only (no onState)
         * @returns {string | null} applied state, or null if invalid
         */
        setState(state, opts = {}) {
          let s = String(state || '').trim().toLowerCase();
          if (STATE_ALIASES[s]) s = STATE_ALIASES[s];
          if (!ALLOWED_STATES.has(s)) return null;
          const detail = opts.detail != null ? sanitizeDetailText(opts.detail) : '';
          if (opts.emit === false) {
            lastState = s;
            lastDetail = detail;
            lastAt = Date.now();
            const entry = { state: s, at: lastAt };
            if (detail) entry.detail = detail;
            history.push(entry);
            if (history.length > 50) history.shift();
            return s;
          }
          applyState(s, { detail });
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
  DETAIL_MAX,
  parseStateBody,
  parseStatePayload,
  mapHookEventToState,
  stateFromNotification,
  isNotificationEvent,
  normalizeEventKey,
  summarizeHookDetail,
  sanitizeDetailText,
  humanizeToolName,
  pickToolTarget,
  startStateServer,
  isLoopback,
  isBrowserOrigin,
};
