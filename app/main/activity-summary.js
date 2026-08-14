'use strict';

/**
 * Turn a Grok hook envelope into a short, specific activity line.
 * Used by the localhost state server and by ~/.grok/hooks/pet-state.js
 * (copied next to the hook script on install — keep this file dependency-free).
 */

const DETAIL_MAX = 80;
const PATH_MAX = 36;
const CMD_MAX = 40;
const QUERY_MAX = 32;

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
  s = s
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-…')
    .replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{12,}\b/gi, 'Bearer …')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, (m) => (m.length > 48 ? `${m.slice(0, 8)}…` : m));
  if (s.length > max) s = s.slice(0, Math.max(0, max - 1)) + '…';
  return s;
}

/**
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
 * @param {unknown} toolName
 * @returns {string}
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
 * Short path/file label (last 1–2 segments).
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function shortPath(value, max = PATH_MAX) {
  let v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (/[/\\]/.test(v)) {
    const parts = v.split(/[/\\]/).filter(Boolean);
    if (parts.length > 1) v = parts.slice(-2).join('/');
  }
  return sanitizeDetailText(v, max);
}

/**
 * Shorten a shell command: binary + first meaningful args.
 * @param {unknown} command
 * @param {number} [max]
 * @returns {string}
 */
function shortCommand(command, max = CMD_MAX) {
  let c = String(command == null ? '' : command)
    .replace(/\s+/g, ' ')
    .trim();
  if (!c) return '';
  c = c.replace(/^(sudo|env|npx|npm exec)\s+/i, '');
  if (c.length <= max) return sanitizeDetailText(c, max);

  const tokens = c.split(' ').filter(Boolean);
  if (!tokens.length) return '';
  const keep = [tokens[0]];
  for (let i = 1; i < tokens.length && keep.join(' ').length < max - 1; i++) {
    const t = tokens[i];
    // Skip long quoted blobs / huge flags
    if (t.length > 28 && /^-/.test(t) === false) {
      keep.push(t.slice(0, 20) + '…');
      break;
    }
    keep.push(t);
  }
  return sanitizeDetailText(keep.join(' '), max);
}

/**
 * Host + short path for a URL.
 * @param {unknown} value
 * @returns {string}
 */
function shortUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  try {
    const withProto = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withProto);
    let pathPart = u.pathname && u.pathname !== '/' ? u.pathname : '';
    if (pathPart.length > 18) pathPart = pathPart.slice(0, 17) + '…';
    return sanitizeDetailText(`${u.hostname}${pathPart}`, 36);
  } catch {
    return sanitizeDetailText(raw.replace(/^https?:\/\//i, ''), 28);
  }
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
    open_page_with_find: 'Fetch',
    spawn_subagent: 'Helper',
    task: 'Helper',
    todo_write: 'Tasks',
    image_gen: 'Image',
    image_edit: 'Image',
    image_to_video: 'Video',
    reference_to_video: 'Video',
    ask_user_question: 'Question',
    enter_plan_mode: 'Plan',
    exit_plan_mode: 'Plan',
    search_tool: 'Tools',
    use_tool: 'Tool',
    workflow: 'Workflow',
    monitor: 'Watch',
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
 * @param {unknown} toolInput
 * @param {string[]} keys
 * @returns {string}
 */
function firstField(toolInput, keys) {
  for (const k of keys) {
    const v = inputField(toolInput, k);
    if (v) return v;
  }
  return '';
}

/**
 * Grok (and some runners) occasionally stringify toolInput.
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function coerceToolInput(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
  if (typeof raw === 'object') return /** @type {Record<string, unknown>} */ (raw);
  return null;
}

/**
 * @param {Record<string, unknown>} envelope
 * @returns {string}
 */
function eventKeyFromEnvelope(envelope) {
  return normalizeEventKey(
    envelope.hookEventName ||
      envelope.hook_event_name ||
      envelope.event ||
      envelope.eventName ||
      envelope.name ||
      ''
  ).replace(/_/g, '');
}

function isPostTool(ev) {
  return ev === 'posttooluse';
}

function isFailTool(ev) {
  return ev === 'posttoolusefailure' || ev === 'permissiondenied';
}

/**
 * First useful slice of the user's prompt.
 * @param {Record<string, unknown>} envelope
 * @param {number} [max]
 * @returns {string}
 */
function promptSnippet(envelope, max = 48) {
  const raw =
    envelope.prompt ||
    envelope.userPrompt ||
    envelope.user_prompt ||
    envelope.message ||
    envelope.text ||
    '';
  let p = String(raw || '')
    .replace(/<\/?user_query>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!p) return '';
  return sanitizeDetailText(p, max);
}

/**
 * @deprecated kept for tests / callers that only need a short path-ish target
 * @param {unknown} toolInput
 * @returns {string}
 */
function pickToolTarget(toolInput) {
  const o = coerceToolInput(toolInput);
  if (!o) return '';
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
      if (k === 'url') return shortUrl(o[k]);
      return sanitizeDetailText(o[k], 36);
    }
  }
  return '';
}

/**
 * @param {string} present
 * @param {string} past
 * @param {string} ev
 * @returns {string}
 */
function tense(present, past, ev) {
  if (isFailTool(ev)) return present;
  return isPostTool(ev) ? past : present;
}

/**
 * Build a sentence for a known / unknown tool.
 * @param {unknown} toolName
 * @param {unknown} toolInputRaw
 * @param {string} ev
 * @returns {string}
 */
function summarizeTool(toolName, toolInputRaw, ev) {
  const key = toolKey(toolName);
  if (!key) return '';
  const toolInput = coerceToolInput(toolInputRaw);
  const file = shortPath(
    firstField(toolInput, ['target_file', 'file_path', 'path', 'filename', 'file'])
  );
  const cmd = shortCommand(firstField(toolInput, ['command']));
  const query = sanitizeDetailText(
    firstField(toolInput, ['query', 'pattern', 'q']),
    QUERY_MAX
  );
  const desc = sanitizeDetailText(
    firstField(toolInput, ['description', 'prompt', 'task']),
    36
  );
  const url = shortUrl(firstField(toolInput, ['url']));
  const failPrefix = isFailTool(ev) ? 'Failed: ' : '';

  if (
    key === 'run_terminal_command' ||
    key === 'bash' ||
    key === 'shell' ||
    key === 'shell_command'
  ) {
    if (cmd) {
      return sanitizeDetailText(
        failPrefix + tense('Running', 'Ran', ev) + ' ' + cmd
      );
    }
    return failPrefix ? 'A command failed' : tense('Running a command', 'Ran a command', ev);
  }

  if (key === 'read_file' || key === 'read') {
    if (file) return sanitizeDetailText(tense('Reading', 'Read', ev) + ' ' + file);
    return tense('Reading a file', 'Read a file', ev);
  }

  if (key === 'search_replace' || key === 'edit' || key === 'multiedit') {
    if (file) return sanitizeDetailText(tense('Editing', 'Edited', ev) + ' ' + file);
    return tense('Editing code', 'Edited code', ev);
  }

  if (key === 'write' || key === 'write_file') {
    if (file) return sanitizeDetailText(tense('Writing', 'Wrote', ev) + ' ' + file);
    return tense('Writing a file', 'Wrote a file', ev);
  }

  if (key === 'grep') {
    if (query && file) {
      return sanitizeDetailText(tense('Searching for', 'Searched for', ev) + ` ${query} in ${file}`);
    }
    if (query) return sanitizeDetailText(tense('Searching for', 'Searched for', ev) + ' ' + query);
    return tense('Searching the codebase', 'Searched the codebase', ev);
  }

  if (key === 'glob') {
    const pattern = query || sanitizeDetailText(firstField(toolInput, ['glob_pattern', 'glob']), 28);
    if (pattern) return sanitizeDetailText(tense('Finding', 'Found', ev) + ' ' + pattern);
    return tense('Finding files', 'Found files', ev);
  }

  if (key === 'list_dir' || key === 'listdir') {
    if (file) return sanitizeDetailText(tense('Browsing', 'Browsed', ev) + ' ' + file);
    return tense('Browsing files', 'Browsed files', ev);
  }

  if (key === 'web_search' || key === 'websearch') {
    if (query) return sanitizeDetailText('Web search: ' + query);
    return tense('Searching the web', 'Searched the web', ev);
  }

  if (key === 'web_fetch' || key === 'open_page' || key === 'open_page_with_find') {
    if (url) return sanitizeDetailText(tense('Fetching', 'Fetched', ev) + ' ' + url);
    return tense('Fetching a page', 'Fetched a page', ev);
  }

  if (key === 'spawn_subagent' || key === 'task') {
    const kind = sanitizeDetailText(
      firstField(toolInput, ['subagent_type', 'subagentType', 'agentType', 'agent_type']),
      20
    );
    if (desc) return sanitizeDetailText('Helper: ' + desc);
    if (kind) return sanitizeDetailText('Starting ' + kind + ' helper');
    return 'Starting a helper';
  }

  if (key === 'todo_write') {
    const todos = toolInput && (toolInput.todos || toolInput.items);
    if (Array.isArray(todos) && todos.length) {
      const n = todos.length;
      return n === 1 ? 'Updating 1 task' : `Updating ${n} tasks`;
    }
    return 'Updating the task list';
  }

  if (key === 'image_gen' || key === 'image_edit') {
    const p = sanitizeDetailText(firstField(toolInput, ['prompt']), 28);
    return p ? sanitizeDetailText('Drawing ' + p) : 'Working on an image';
  }

  if (key === 'image_to_video' || key === 'reference_to_video') {
    return 'Making a video';
  }

  if (key === 'ask_user_question') {
    return 'Waiting for your answer';
  }

  if (key === 'enter_plan_mode') return 'Planning the approach';
  if (key === 'exit_plan_mode') return 'Leaving plan mode';

  if (key === 'search_tool') {
    return query ? sanitizeDetailText('Looking up tool: ' + query) : 'Looking up a tool';
  }

  if (key === 'use_tool') {
    const inner = firstField(toolInput, ['tool_name', 'toolName', 'name']);
    const label = humanizeToolName(inner);
    return label ? sanitizeDetailText('Using ' + label) : 'Using a tool';
  }

  if (key === 'workflow') {
    const name = sanitizeDetailText(firstField(toolInput, ['name', 'script']), 24);
    return name ? sanitizeDetailText('Workflow: ' + name) : 'Running a workflow';
  }

  if (key === 'monitor' || key === 'get_command_or_subagent_output') {
    if (cmd) return sanitizeDetailText('Watching ' + cmd);
    if (desc) return sanitizeDetailText('Watching ' + desc);
    return 'Watching a task';
  }

  if (key === 'kill_command_or_subagent') return 'Stopping a task';

  if (
    key === 'x_keyword_search' ||
    key === 'x_semantic_search' ||
    key === 'x_user_search' ||
    key === 'x_thread_fetch'
  ) {
    if (query) return sanitizeDetailText('Searching X for ' + query);
    return 'Searching X';
  }

  if (key === 'web_search' /* already handled */) {
    /* unreachable */
  }

  const label = humanizeToolName(toolName);
  if (failPrefix) {
    if (file) return sanitizeDetailText('Failed: ' + (label ? `${label} on ${file}` : file));
    if (label) return sanitizeDetailText('Failed: ' + label);
    return 'A tool failed';
  }
  if (file) return sanitizeDetailText(`Using ${label} on ${file}`);
  if (url) return sanitizeDetailText(`Using ${label} on ${url}`);
  if (query) return sanitizeDetailText(`Using ${label}: ${query}`);
  if (desc) return sanitizeDetailText(`Using ${label}: ${desc}`);
  if (label) return sanitizeDetailText('Using ' + label);
  return '';
}

/**
 * Lifecycle fallbacks when the envelope has no tool (or a bare state).
 * Empty string means "don't invent a line — keep the last real one".
 * @param {Record<string, unknown>} envelope
 * @param {string} ev
 * @returns {string}
 */
function summarizeEvent(envelope, ev) {
  if (ev === 'userpromptsubmit' || ev === 'beforesubmitprompt') {
    const snippet = promptSnippet(envelope);
    return snippet || 'Reading your request';
  }
  if (ev === 'pretooluse') return 'Starting a tool';
  if (ev === 'posttooluse') return '';
  if (ev === 'posttoolusefailure') return 'A tool failed';
  if (ev === 'permissiondenied') return 'Permission denied';
  if (ev === 'stop') return 'Finished this turn';
  if (ev === 'stopfailure') return 'The turn hit an error';
  if (ev === 'subagentstart') {
    const kind = sanitizeDetailText(
      envelope.subagentType ||
        envelope.subagent_type ||
        envelope.agentType ||
        envelope.agent_type ||
        '',
      20
    );
    return kind ? `Starting ${kind} helper` : 'Starting a helper';
  }
  if (ev === 'subagentstop' || ev === 'subagentend') return 'Helper finished';
  if (ev === 'sessionstart') return '';
  if (ev === 'sessionend') return '';
  if (ev === 'notification') {
    const type = normalizeEventKey(
      envelope.notificationType ||
        envelope.notification_type ||
        envelope.type ||
        envelope.notification ||
        ''
    );
    if (/approval|permission|actionrequired|needs?input|confirm|waiting/.test(type)) {
      return 'Waiting for your OK';
    }
    if (/error|fail|denied/.test(type)) return 'Something went wrong';
    return '';
  }

  const st = String(envelope.state || '')
    .trim()
    .toLowerCase();
  if (st === 'thinking') return 'Reading your request';
  if (st === 'working') return '';
  if (st === 'done') return 'Finished this turn';
  if (st === 'alert') return 'Needs your attention';
  return '';
}

/**
 * Build a plain-language activity line for the status bubble.
 * Prefer short readable sentences over raw tool · path dumps.
 * Returns empty when nothing useful is known (caller should keep the last line).
 * @param {unknown} envelope
 * @returns {string}
 */
function summarizeHookDetail(envelope) {
  if (!envelope || typeof envelope !== 'object') return '';
  const j = /** @type {Record<string, unknown>} */ (envelope);

  // Explicit detail from tests / pre-formatted payloads
  if (j.detail != null && String(j.detail).trim()) {
    return sanitizeDetailText(j.detail);
  }

  const ev = eventKeyFromEnvelope(j);
  const toolName = j.toolName || j.tool_name || j.tool || '';
  const toolInput = j.toolInput || j.tool_input || j.input || j.parameters || null;

  if (toolName) {
    const line = summarizeTool(toolName, toolInput, ev);
    if (line) return line;
  }

  const fromEvent = summarizeEvent(j, ev);
  if (fromEvent) return fromEvent;

  const prompt = promptSnippet(j);
  if (prompt && (ev === 'userpromptsubmit' || ev === 'beforesubmitprompt' || !ev)) {
    return prompt;
  }

  return '';
}

module.exports = {
  DETAIL_MAX,
  sanitizeDetailText,
  normalizeEventKey,
  toolKey,
  shortPath,
  shortCommand,
  shortUrl,
  humanizeToolName,
  pickToolTarget,
  coerceToolInput,
  promptSnippet,
  summarizeTool,
  summarizeHookDetail,
};
