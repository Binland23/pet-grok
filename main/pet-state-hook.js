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
 * NOTE: This file is copied standalone into ~/.grok/hooks/ — keep it self-contained
 * (no require of other Pet Grok modules). Refresh hooks after changes.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEBUG_LOG = path.join(os.homedir(), '.grok', 'hooks', 'pet-state.debug.log');
const DETAIL_MAX = 64;
const STDIN_MAX = 8192;

function dbg(msg) {
  try {
    fs.appendFileSync(
      DEBUG_LOG,
      new Date().toISOString() +
        ' ' +
        msg +
        ' argv=' +
        JSON.stringify(process.argv) +
        ' GROK_HOOK_EVENT=' +
        String(process.env.GROK_HOOK_EVENT || '') +
        '\n',
      'utf8'
    );
  } catch {
    /* ignore */
  }
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
    // Bare notification → idle; type-specific mapping in stateFromNotification
    notification: 'idle',
    sessionend: 'sleep',
    session_end: 'sleep',
    subagentstart: 'working',
    subagent_start: 'working',
    subagentstop: 'working',
    subagent_stop: 'working',
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

function sanitizeDetailText(value, max) {
  const limit = max != null ? max : DETAIL_MAX;
  let s = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  s = s
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-…')
    .replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{12,}\b/gi, 'Bearer …')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, (m) => (m.length > 48 ? m.slice(0, 8) + '…' : m));
  if (s.length > limit) s = s.slice(0, Math.max(0, limit - 1)) + '…';
  return s;
}

function toolKey(toolName) {
  const raw = String(toolName || '').trim();
  if (!raw) return '';
  const base = raw.includes('__') ? raw.split('__').pop() : raw;
  return String(base)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

function shortPath(value) {
  let v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (/[/\\]/.test(v)) {
    const parts = v.split(/[/\\]/).filter(Boolean);
    if (parts.length > 1) v = parts.slice(-2).join('/');
  }
  return sanitizeDetailText(v, 28);
}

function shortCommand(command) {
  let c = String(command == null ? '' : command)
    .replace(/\s+/g, ' ')
    .trim();
  if (!c) return '';
  c = c.replace(/^(sudo|env|npx|npm exec)\s+/i, '');
  return sanitizeDetailText(c, 28);
}

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

function inputField(toolInput, key) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (toolInput[key] == null || !String(toolInput[key]).trim()) return '';
  return String(toolInput[key]).trim();
}

/**
 * Plain-language activity line for the status bubble.
 * @param {Record<string, unknown> | null} envelope
 * @returns {string}
 */
function summarizeHookDetail(envelope) {
  if (!envelope || typeof envelope !== 'object') return '';
  if (envelope.detail != null && String(envelope.detail).trim()) {
    return sanitizeDetailText(envelope.detail);
  }
  const toolName = envelope.toolName || envelope.tool_name || envelope.tool || '';
  const toolInput = envelope.toolInput || envelope.tool_input || envelope.input || null;
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
      return cmd ? sanitizeDetailText('Running ' + cmd) : 'Running a command';
    }
    if (key === 'read_file' || key === 'read') {
      return file ? sanitizeDetailText('Reading ' + file) : 'Reading a file';
    }
    if (key === 'search_replace' || key === 'edit' || key === 'multiedit') {
      return file ? sanitizeDetailText('Editing ' + file) : 'Editing code';
    }
    if (key === 'write' || key === 'write_file') {
      return file ? sanitizeDetailText('Writing ' + file) : 'Writing a file';
    }
    if (key === 'grep') {
      return query ? sanitizeDetailText('Searching for ' + query) : 'Searching the codebase';
    }
    if (key === 'glob') {
      return query ? sanitizeDetailText('Finding ' + query) : 'Finding files';
    }
    if (key === 'list_dir' || key === 'listdir') {
      return file ? sanitizeDetailText('Browsing ' + file) : 'Browsing files';
    }
    if (key === 'web_search' || key === 'websearch') {
      return query ? sanitizeDetailText('Web search: ' + query) : 'Searching the web';
    }
    if (key === 'web_fetch' || key === 'open_page') return 'Fetching a page';
    if (key === 'spawn_subagent' || key === 'task') {
      return desc ? sanitizeDetailText('Helper: ' + desc) : 'Starting a helper agent';
    }
    if (key === 'todo_write') return 'Updating the task list';
    if (key === 'image_gen' || key === 'image_edit') return 'Working on an image';
    const label = humanizeToolName(toolName);
    if (file) return sanitizeDetailText('Using ' + label + ' on ' + file);
    if (label) return sanitizeDetailText('Using ' + label);
  }
  const prompt = envelope.prompt || envelope.userPrompt || envelope.user_prompt || envelope.message || '';
  if (prompt && String(prompt).trim()) {
    let p = String(prompt)
      .replace(/<\/?user_query>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (p.length > 40) p = p.slice(0, 39) + '…';
    return p ? sanitizeDetailText('On: ' + p) : 'Thinking about your request';
  }
  const st = String(envelope.state || '')
    .trim()
    .toLowerCase();
  if (st === 'thinking') return 'Thinking it through…';
  if (st === 'working') return 'Getting things done…';
  if (st === 'done') return 'All done!';
  if (st === 'alert') return 'Needs your attention';
  return '';
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
      // Settle quickly: argv usually has state; stdin is for detail enrichment
      setTimeout(finish, 80);
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
  // Fail-open: exit 0 even if pet app is not running
  process.exit(0);
}

main().catch((err) => {
  dbg('main error ' + (err && err.message));
  process.exit(0);
});
