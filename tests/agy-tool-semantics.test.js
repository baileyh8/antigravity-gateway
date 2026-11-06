'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { classifyTool, buildRule } = require('../src/agy-tool-semantics');
const { isBijective, arbitrate } = require('../src/agy-tool-mapping');
const { prepareToolAdapter } = require('../src/agy-tool-adapter');
const { normalizeChat } = require('../src/protocol');

// Declarations written the way an unfamiliar client would send them: no
// capture, no known user agent, no recognized profile.
const fn = (name, properties, required = []) => ({
  type: 'function',
  function: {
    name, description: `${name} does something`,
    parameters: { type: 'object', additionalProperties: false, properties, required }
  }
});
const READ = fn('open_file', { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, ['path']);
const EXEC = fn('sh', { command: { type: 'string' }, workdir: { type: 'string' } }, ['command']);
const WRITE = fn('save', { file_path: { type: 'string' }, content: { type: 'string' } }, ['file_path', 'content']);
const payload = tools => ({ model: 'gemini-3.8-flash-high', messages: [{ role: 'user', content: 'hello' }], tools });
const names = tools => tools.map(tool => tool.name);

test('an unknown client gains read and exec mappings from the declaration shape alone', () => {
  const out = prepareToolAdapter(normalizeChat(payload([structuredClone(READ), structuredClone(EXEC)])), { clientProfile: '' });
  assert.deepEqual(names(out.normalized.tools), ['view_file', 'run_command']);
  const call = out.toClient({ id: 'c', name: 'view_file', arguments: { AbsolutePath: '/notes.md', StartLine: 5, EndLine: 9 } });
  assert.deepEqual(call, { id: 'c', name: 'open_file', arguments: { path: '/notes.md', offset: 5, limit: 5 } });
  const shell = out.toClient({ id: 's', name: 'run_command', arguments: { CommandLine: 'ls -la', Cwd: '/tmp' } });
  assert.deepEqual(shell, { id: 's', name: 'sh', arguments: { command: 'ls -la', workdir: '/tmp' } });
});

test('a tool that merely shares a name is never translated', () => {
  const custom = fn('read', { path: { type: 'string' }, encoding: { type: 'string' } }, ['path']);
  assert.equal(classifyTool(normalizeChat(payload([custom])).tools[0]), null);
  const out = prepareToolAdapter(normalizeChat(payload([custom, structuredClone(EXEC)])), { clientProfile: '' });
  assert.ok(names(out.normalized.tools).includes('read'));
});

test('a lone one-argument declaration stays untranslated', () => {
  const bare = fn('open_file', { path: { type: 'string' } }, ['path']);
  const out = prepareToolAdapter(normalizeChat(payload([bare])), { clientProfile: '' });
  assert.deepEqual(names(out.normalized.tools), ['open_file']);
});

test('a single family with two arguments and a known name is accepted', () => {
  const lone = fn('open_file', { path: { type: 'string' }, offset: { type: 'number' } }, ['path']);
  const out = prepareToolAdapter(normalizeChat(payload([lone])), { clientProfile: '' });
  assert.deepEqual(names(out.normalized.tools), ['view_file']);
});

test('a single family with an unfamiliar name stays untranslated', () => {
  const lone = fn('inspect_config', { path: { type: 'string' }, offset: { type: 'number' } }, ['path']);
  const out = prepareToolAdapter(normalizeChat(payload([lone])), { clientProfile: '' });
  assert.deepEqual(names(out.normalized.tools), ['inspect_config']);
});

test('the reported tool count ignores gateway-internal tools', () => {
  const internal = { name: 'generate_image', kind: 'function', internal: true,
    description: 'internal', schema: { type: 'object', additionalProperties: false, properties: {} } };
  const n = normalizeChat(payload([structuredClone(READ), structuredClone(EXEC)]));
  n.tools.push(internal);
  const out = prepareToolAdapter(n, { clientProfile: '' });
  assert.equal(out.toolCount, 2);
  assert.equal(out.mappingCount, 2);
});

test('a client web search tool maps onto the captured search_web declaration', () => {
  const search = fn('web_search', { query: { type: 'string' }, domain: { type: 'string' } }, ['query']);
  const exec = structuredClone(EXEC);
  const out = prepareToolAdapter(normalizeChat(payload([search, exec])), { clientProfile: '' });
  assert.deepEqual(names(out.normalized.tools), ['search_web', 'run_command']);
  const back = out.toClient({ id: 's', name: 'search_web', arguments: { query: 'latest node lts' } });
  assert.deepEqual(back, { id: 's', name: 'web_search', arguments: { query: 'latest node lts' } });
});

test('a search tool with an argument outside the family is declined', () => {
  const search = fn('google_search', { q: { type: 'string' }, num: { type: 'number' } }, ['q']);
  assert.equal(classifyTool(normalizeChat(payload([search])).tools[0]), null);
});

test('patch is recognized as an edit alias for profile-less clients', () => {
  const patch = fn('patch', { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, ['path', 'old_string', 'new_string']);
  const out = prepareToolAdapter(normalizeChat(payload([patch])), { clientProfile: '' });
  assert.deepEqual(names(out.normalized.tools), ['replace_file_content']);
  const back = out.toClient({ id: 'p', name: 'replace_file_content', arguments: { TargetFile: '/a', TargetContent: 'x', ReplacementContent: 'y' } });
  assert.deepEqual(back, { id: 'p', name: 'patch', arguments: { path: '/a', old_string: 'x', new_string: 'y' } });
});

test('a multi-command editor and a free-form patch tool are both declined', () => {
  const editor = fn('str_replace_editor', { command: { type: 'string' }, path: { type: 'string' },
    file_text: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, ['command', 'path']);
  assert.equal(classifyTool(normalizeChat(payload([editor])).tools[0]), null);
  const v4a = fn('apply_patch', { patch: { type: 'string' } }, ['patch']);
  assert.equal(classifyTool(normalizeChat(payload([v4a])).tools[0]), null);
});

test('two declarations competing for the same native tool are both left alone', () => {
  const first = fn('open_a', { file_path: { type: 'string' } }, ['file_path']);
  const second = fn('open_b', { path: { type: 'string' } }, ['path']);
  const out = prepareToolAdapter(normalizeChat(payload([first, second, structuredClone(EXEC)])), { clientProfile: '' });
  const result = names(out.normalized.tools);
  assert.ok(result.includes('open_a') && result.includes('open_b'));
  assert.ok(result.includes('run_command'));
  assert.ok(!result.includes('view_file'));
});

test('a native name the client already declared is never shadowed', () => {
  const occupied = fn('view_file', { path: { type: 'string' } }, ['path']);
  const out = prepareToolAdapter(normalizeChat(payload([structuredClone(READ), structuredClone(EXEC), occupied])), { clientProfile: '' });
  const result = names(out.normalized.tools);
  assert.ok(result.includes('view_file'));
  assert.ok(result.includes('open_file'));
  assert.ok(result.includes('run_command'));
});

test('a captured profile stays authoritative and disables the semantic layer', () => {
  const out = prepareToolAdapter(normalizeChat(payload([structuredClone(READ), structuredClone(EXEC)])), { clientProfile: 'dsh-0.2.1-captured' });
  assert.deepEqual(names(out.normalized.tools), ['open_file', 'sh']);
  assert.equal(out.adapted, false);
});

test('the bijection check rejects a partial map', () => {
  const tool = normalizeChat(payload([structuredClone(READ)])).tools[0];
  const classified = classifyTool(tool);
  assert.ok(isBijective(tool, buildRule(classified)));
  assert.equal(isBijective(tool, { name: 'view_file', parameters: { path: 'AbsolutePath' } }), false);
  assert.equal(isBijective(tool, { name: 'view_file', parameters: { path: 'AbsolutePath', offset: 'StartLine', limit: 'StartLine' } }), false);
  assert.equal(isBijective(tool, { name: 'view_file', parameters: { path: 'AbsolutePath', offset: 'StartLine', limit: 'EndLine', extra: 'Extra' } }), false);
});

test('arbitration reports why a candidate was declined instead of picking a winner', () => {
  const tool = normalizeChat(payload([structuredClone(READ)])).tools[0];
  const rule = buildRule(classifyTool(tool));
  const taken = arbitrate([{ tool, rule, layer: 'semantic' }], new Set(['view_file']));
  assert.equal(taken.mappings.size, 0);
  assert.deepEqual(taken.declined, [{ native: 'view_file', reason: 'client_declares_native_name' }]);
  const contested = arbitrate([{ tool, rule, layer: 'semantic' }, { tool, rule, layer: 'semantic' }], new Set());
  assert.equal(contested.mappings.size, 0);
  assert.equal(contested.declined[0].reason, 'contested_by_multiple_declarations');
});

test('write and exec map without needing three families', () => {
  const out = prepareToolAdapter(normalizeChat(payload([structuredClone(WRITE), structuredClone(EXEC)])), { clientProfile: '' });
  assert.deepEqual(names(out.normalized.tools), ['write_to_file', 'run_command']);
});

test('the semantic layer can be switched off to restore strict passthrough', () => {
  const adapterPath = require.resolve('../src/agy-tool-adapter');
  const normalized = normalizeChat(payload([structuredClone(READ), structuredClone(EXEC)]));
  const saved = process.env.ANTIGRAVITY_TOOL_SEMANTICS;
  process.env.ANTIGRAVITY_TOOL_SEMANTICS = 'off';
  delete require.cache[adapterPath];
  try {
    const fresh = require('../src/agy-tool-adapter');
    assert.deepEqual(names(fresh.prepareToolAdapter(normalized, { clientProfile: '' }).normalized.tools), ['open_file', 'sh']);
  } finally {
    if (saved === undefined) delete process.env.ANTIGRAVITY_TOOL_SEMANTICS;
    else process.env.ANTIGRAVITY_TOOL_SEMANTICS = saved;
    delete require.cache[adapterPath];
    require('../src/agy-tool-adapter');
  }
});

