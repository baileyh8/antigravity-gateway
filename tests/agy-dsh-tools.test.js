'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { capturedNativeClient } = require('../src/agy-client-profile');
const { DSH_CLIENT_PROFILE, READ_SECTION, WRITE_SECTION, WRITE_EDIT_TAIL, EDIT_SECTION, capturedDshTool } = require('../src/agy-dsh-profile');
const { prepareToolAdapter } = require('../src/agy-tool-adapter');
const { normalizeChat } = require('../src/protocol');

// Declarations captured from dsh-tool-fs and dsh-tool-bash 0.2.1-rc.2.
const tools = [
  { type: 'function', function: { name: 'read', description: 'Read a UTF-8 text file and return line-numbered content.', parameters: {
    type: 'object', additionalProperties: false, required: ['file_path'], properties: {
      file_path: { type: 'string', description: 'Path to read, resolved by the filesystem backend.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: 'Maximum number of lines to return.' }
    } } } },
  { type: 'function', function: { name: 'write', description: 'Create or fully replace a UTF-8 text file.', parameters: {
    type: 'object', additionalProperties: false, required: ['file_path', 'content'], properties: {
      file_path: { type: 'string', description: 'Path to write.' },
      content: { type: 'string', description: 'Full UTF-8 text content to write.' }
    } } } },
  { type: 'function', function: { name: 'edit', description: 'Edit an existing UTF-8 text file by replacing literal text.', parameters: {
    type: 'object', additionalProperties: false, required: ['file_path', 'old_string', 'new_string'], properties: {
      file_path: { type: 'string', description: 'Path to edit.' },
      old_string: { type: 'string', description: 'Literal text to replace.' },
      new_string: { type: 'string', description: 'Literal replacement text.' },
      replace_all: { type: 'boolean', description: 'Replace all matches.' }
    } } } },
  { type: 'function', function: { name: 'bash', description: 'Execute a bash command (`bash -c`) and return its stdout/stderr. Provide `description` before `command` in the arguments.', parameters: {
    type: 'object', additionalProperties: false, required: ['description', 'command'], properties: {
      description: { type: 'string', description: 'Clear, concise description of what this command does in active voice.' },
      command: { type: 'string', description: 'The bash command to execute.' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds.' },
      workdir: { type: 'string', description: 'Working directory for this command.' },
      sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'], description: 'Wider sandbox mode.' },
      justification: { type: 'string', description: 'Required with sandbox_permissions.' }
    } } } }
];

const system = ['You are dsh.', READ_SECTION,
  WRITE_SECTION + WRITE_EDIT_TAIL, EDIT_SECTION,
  'Check the [exit code: N] marker on every bash result; investigate failures before moving on.'].join('\n\n');

const payload = (overrides = {}) => ({
  model: 'gemini-3.8-flash-high',
  messages: [{ role: 'system', content: system }, { role: 'user', content: 'keep `read` and `bash` as literal words in this message' }],
  tools: structuredClone(tools), ...overrides
});
const headers = { 'user-agent': 'deepseek-harness/0.2.1-rc.3 (+https://github.com/deepseek-ai/deepseek-harness)' };

test('dsh identity needs the harness user agent, a captured prompt section and a captured declaration', () => {
  const n = normalizeChat(payload());
  assert.equal(capturedNativeClient({ headers }, n), DSH_CLIENT_PROFILE);
  assert.equal(capturedNativeClient({ headers: { 'user-agent': 'Bun/1.4.4' } }, n), '');
  assert.equal(capturedNativeClient({ headers: { 'user-agent': 'deepseek-harness' } }, n), '');
  assert.equal(capturedNativeClient({ headers }, normalizeChat(payload({ messages: [{ role: 'system', content: 'You are dsh.' }, { role: 'user', content: READ_SECTION }] }))), '');
  assert.equal(capturedNativeClient({ headers }, normalizeChat(payload({ tools: [] }))), '');
  assert.equal(capturedNativeClient({ headers }, normalizeChat(payload({ tools: [tools[0], tools[3]] }))), DSH_CLIENT_PROFILE);
});

test('a lowercase declaration that only looks like dsh does not translate', () => {
  const near = normalizeChat(payload({ tools: [tools[0]] })).tools[0];
  assert.equal(capturedDshTool(near), true);
  const wrongType = structuredClone(near);
  wrongType.schema.properties.limit.type = 'string';
  assert.equal(capturedDshTool(wrongType), false);
  const extraField = structuredClone(near);
  extraField.schema.properties.cwd = { type: 'string' };
  assert.equal(capturedDshTool(extraField), false);
  const wrongDescription = structuredClone(near);
  wrongDescription.description = 'Read a file.';
  assert.equal(capturedDshTool(wrongDescription), false);
  // A client that reuses the word without the captured sentence is not dsh.
  assert.equal(capturedNativeClient({ headers }, normalizeChat(payload({ tools: [structuredClone(tools[1])], messages: [{ role: 'system', content: 'You are dsh.' }, { role: 'user', content: 'hi' }] }))), '');
});

test('dsh declarations translate to the native names and stay reversible', () => {
  const n = normalizeChat(payload()), a = prepareToolAdapter(n, { clientProfile: DSH_CLIENT_PROFILE });
  assert.deepEqual(a.normalized.tools.map(t => t.name), ['view_file', 'write_to_file', 'replace_file_content', 'run_command']);
  const [read, write, edit, bash] = a.normalized.tools;
  assert.deepEqual(Object.keys(read.schema.properties), ['AbsolutePath', 'StartLine', 'EndLine', 'toolAction', 'toolSummary']);
  assert.equal(read.schema.properties.AbsolutePath.description, 'Path to read, resolved by the filesystem backend.');
  assert.equal(read.schema.properties.EndLine.type, 'integer');
  assert.deepEqual(Object.keys(write.schema.properties), ['TargetFile', 'CodeContent', 'toolAction', 'toolSummary']);
  assert.equal(edit.schema.properties.AllowMultiple.type, 'boolean');
  assert.deepEqual(Object.keys(bash.schema.properties), ['Description', 'CommandLine', 'TimeoutMs', 'Cwd', 'BypassSandbox', 'Justification', 'toolAction', 'toolSummary']);
  assert.equal(bash.schema.properties.BypassSandbox.type, 'boolean');
  assert.match(bash.description, /Provide `Description` before `CommandLine`/);

  const call = { id: 'c1', name: 'run_command', arguments: { CommandLine: 'ls', Description: 'List files', Cwd: '/tmp', TimeoutMs: 5000, BypassSandbox: true, Justification: 'Need access', toolAction: 'Listed', toolSummary: 'List' } };
  assert.deepEqual(a.toClient(call).arguments, { command: 'ls', description: 'List files', workdir: '/tmp', timeoutMs: 5000, sandbox_permissions: 'danger-full-access', justification: 'Need access' });
  assert.deepEqual(a.toClient({ ...call, arguments: { CommandLine: 'ls', Description: 'List', BypassSandbox: false } }).arguments, { command: 'ls', description: 'List', sandbox_permissions: 'workspace-write' });
});

test('dsh prompt translation only touches the captured sentences', () => {
  const n = normalizeChat(payload()), a = prepareToolAdapter(n, { clientProfile: DSH_CLIENT_PROFILE });
  const s = a.normalized.system;
  assert.match(s, /Use the view_file tool/);
  assert.match(s, /Use StartLine and EndLine to continue reading large files/);
  assert.match(s, /overwriting it with write_to_file/);
  assert.match(s, /prefer replace_file_content for targeted changes/);
  assert.match(s, /Check the \[exit code: N\] marker/);
  assert.equal(a.normalized.messages[0].text, n.messages[0].text);
  assert.equal(a.normalized.messages[0].text.includes('view_file'), false);
});
