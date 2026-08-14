'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeHookDetail,
  sanitizeDetailText,
  shortCommand,
  shortPath,
  shortUrl,
  humanizeToolName,
} = require('../main/activity-summary');

describe('summarizeHookDetail — specific activity, not vibe copy', () => {
  it('never invents Getting things done / Thinking it through', () => {
    assert.equal(summarizeHookDetail({ state: 'working' }), '');
    assert.equal(summarizeHookDetail({ state: 'thinking' }), 'Reading your request');
    assert.equal(summarizeHookDetail({ state: 'done' }), 'Finished this turn');
    const line = summarizeHookDetail({
      hookEventName: 'pre_tool_use',
      toolName: 'read_file',
      toolInput: { target_file: '/tmp/app/main.js' },
    });
    assert.doesNotMatch(line, /getting things done/i);
    assert.doesNotMatch(line, /thinking it through/i);
    assert.doesNotMatch(line, /all done/i);
  });

  it('names the file for read / edit / write', () => {
    assert.equal(
      summarizeHookDetail({
        toolName: 'read_file',
        toolInput: { target_file: '/Users/me/project/src/index.js' },
      }),
      'Reading src/index.js'
    );
    assert.equal(
      summarizeHookDetail({
        hookEventName: 'post_tool_use',
        toolName: 'search_replace',
        toolInput: { target_file: 'renderer/pet.js' },
      }),
      'Edited renderer/pet.js'
    );
    assert.equal(
      summarizeHookDetail({
        toolName: 'write',
        toolInput: { file_path: 'app/main/activity-summary.js' },
      }),
      'Writing main/activity-summary.js'
    );
  });

  it('names the command for terminal tools', () => {
    assert.equal(
      summarizeHookDetail({
        hookEventName: 'pre_tool_use',
        toolName: 'run_terminal_command',
        toolInput: { command: 'npm test' },
      }),
      'Running npm test'
    );
    assert.equal(
      summarizeHookDetail({
        hookEventName: 'post_tool_use',
        toolName: 'bash',
        toolInput: { command: 'npm test' },
      }),
      'Ran npm test'
    );
  });

  it('accepts stringified toolInput and snake_case keys', () => {
    assert.equal(
      summarizeHookDetail({
        tool_name: 'read_file',
        tool_input: JSON.stringify({ target_file: 'foo/bar.js' }),
      }),
      'Reading foo/bar.js'
    );
  });

  it('summarizes search, web, helpers, tasks, and MCP tools', () => {
    assert.equal(
      summarizeHookDetail({
        toolName: 'grep',
        toolInput: { pattern: 'setStatus', path: 'renderer/pet.js' },
      }),
      'Searching for setStatus in renderer/pet.js'
    );
    assert.equal(
      summarizeHookDetail({
        toolName: 'web_search',
        toolInput: { query: 'electron tray icon' },
      }),
      'Web search: electron tray icon'
    );
    assert.equal(
      summarizeHookDetail({
        toolName: 'web_fetch',
        toolInput: { url: 'https://example.com/docs/hooks' },
      }),
      'Fetching example.com/docs/hooks'
    );
    assert.equal(
      summarizeHookDetail({
        toolName: 'spawn_subagent',
        toolInput: { description: 'scan status chrome', subagent_type: 'explore' },
      }),
      'Helper: scan status chrome'
    );
    assert.equal(
      summarizeHookDetail({
        toolName: 'todo_write',
        toolInput: { todos: [{ content: 'a' }, { content: 'b' }] },
      }),
      'Updating 2 tasks'
    );
    assert.match(
      summarizeHookDetail({
        toolName: 'github__create_issue',
        toolInput: { title: 'bug' },
      }),
      /Using Create Issue/
    );
  });

  it('uses the prompt on UserPromptSubmit and stays quiet on bare working', () => {
    assert.equal(
      summarizeHookDetail({
        hookEventName: 'user_prompt_submit',
        prompt: 'can you revamp the status feature',
      }),
      'can you revamp the status feature'
    );
    assert.equal(summarizeHookDetail({ hookEventName: 'pre_tool_use' }), 'Starting a tool');
    assert.equal(summarizeHookDetail({ hookEventName: 'post_tool_use' }), '');
    assert.equal(summarizeHookDetail({ hookEventName: 'stop' }), 'Finished this turn');
    assert.equal(
      summarizeHookDetail({
        hookEventName: 'notification',
        notificationType: 'approval_required',
      }),
      'Waiting for your OK'
    );
  });

  it('redacts secrets and truncates', () => {
    const s = sanitizeDetailText('token sk-abcdefghijklmnop and more');
    assert.match(s, /sk-…/);
    assert.ok(sanitizeDetailText('x'.repeat(200)).length <= 80);
  });
});

describe('activity helpers', () => {
  it('shortPath keeps the last two segments', () => {
    assert.equal(shortPath('/Users/me/proj/app/renderer/pet.js'), 'renderer/pet.js');
  });

  it('shortCommand drops sudo/npx and keeps the useful head', () => {
    assert.equal(shortCommand('npx npm test'), 'npm test');
    assert.ok(shortCommand('git status').includes('git'));
  });

  it('shortUrl keeps host + a short path', () => {
    assert.equal(shortUrl('https://example.com/docs/hooks'), 'example.com/docs/hooks');
  });

  it('humanizeToolName maps known tools and MCP suffixes', () => {
    assert.equal(humanizeToolName('run_terminal_command'), 'Terminal');
    assert.equal(humanizeToolName('github__create_issue'), 'Create Issue');
  });
});
