'use strict';
require('./helpers/gateway-environment');

const assert = require('node:assert/strict');
const test = require('node:test');

const { SchemaWorkerPool, compileSchemaAsync, closeSchemaWorkers } = require('../src/schema-contract');
const { prepareAntigravityTools, prepareAntigravityToolsAsync } = require('../src/antigravity-tool-contract');
const { createToolReceiptTransform, attachClientToolResult } = require('../src/agy-tool-results');
const { createAnthropicTextEmitter, createResponsesTextEmitter, textStreamingAllowed } = require('../src/sse-emitters');
const { normalizeAnthropic, normalizeChat, normalizeResponses, anthropicResponse, responsesResponse } = require('../src/protocol');
const { buildDirectRequest, DirectAntigravityProvider } = require('../src/direct-provider');
const { newState } = require('../src/agy-session-state');
const { sanitizeClientIdentity } = require('../src/client-identity');
const { CODEX_CLIENT_PROFILE } = require('../src/agy-client-profile');
const { runRequestLog } = require('../src/request-log');
const { OPEN, CLOSE } = require('../src/client-instruction-envelope');

test.after(closeSchemaWorkers);

function sseHarness() {
  const frames = [];
  const res = { write: chunk => frames.push(chunk), end() { this.ended = true; }, writeHead() {} };
  const events = () => frames.join('').split('\n')
    .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map(line => JSON.parse(line.slice(6)));
  return { res, events };
}

test('schema worker pool caches compiled schemas across calls and deduplicates repeated tool views', async t => {
  const pool = new SchemaWorkerPool({ workers: 1 });
  t.after(() => pool.close());
  let compileExecs = 0;
  const originalExecute = pool.execute.bind(pool);
  pool.execute = (operation, ...rest) => {
    if (operation === 'compile') compileExecs++;
    return originalExecute(operation, ...rest);
  };
  const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
  const v1 = await compileSchemaAsync(schema, { pool });
  const v2 = await compileSchemaAsync(schema, { pool });
  assert.equal(compileExecs, 1);
  assert.equal(pool.cacheStats.misses, 1);
  assert.equal(pool.cacheStats.hits, 1);
  assert.equal(await v1({ query: 'ok' }), true);
  assert.equal(await v2({ query: 123 }), false);

  const tools = Array.from({ length: 8 }, (_, index) => ({
    name: `open_tool_${index}`,
    kind: 'function',
    description: 'Open tool.',
    schema: { type: 'object', properties: { value: { type: 'string' } } }
  }));
  const before = compileExecs;
  await prepareAntigravityToolsAsync({ tools }, { schemaOptions: { pool } });
  const firstBatchCompiles = compileExecs - before;
  await prepareAntigravityToolsAsync({ tools }, { schemaOptions: { pool } });
  assert.equal(compileExecs - before, firstBatchCompiles, 'second identical tool batch should hit compiled schema cache with zero compile IPCs');
});

test('Anthropic and Responses stream text and thinking live even when tools are declared', () => {
  const withTools = { stream: true, protocol: 'anthropic', tools: [{ name: 'bash' }], structuredSchema: null, autoMode: false };
  assert.equal(textStreamingAllowed(withTools, { direct: true }), true);
  assert.equal(textStreamingAllowed(withTools, { direct: false }), false);
  assert.equal(textStreamingAllowed({ ...withTools, protocol: 'responses' }, { direct: true }), true);
  assert.equal(textStreamingAllowed({ ...withTools, structuredSchema: { type: 'object' } }, { direct: true }), false);

  const toolCalls = [
    { id: 'call_a', name: 'read_note', arguments: { path: 'a.txt' }, thoughtSignature: 'sig-a' },
    { id: 'call_b', name: 'read_note', arguments: { path: 'b.txt' } },
    { id: 'call_c', name: 'read_note', arguments: { path: 'c.txt' }, thoughtSignature: 'sig-c' }
  ];
  const raw = { text: '准备读取文件。', thinking: '先检查路径。', toolCalls, usage: { input_tokens: 10, output_tokens: 5 } };

  // Anthropic live emitter with parallel signed tool_use blocks
  const a = sseHarness();
  const aEmitter = createAnthropicTextEmitter(a.res, 'gemini-4-hydrogen-high');
  aEmitter.onThinkingDelta('先检查');
  aEmitter.onDelta('准备读取');
  assert.equal(a.res.ended, undefined);
  aEmitter.finish(anthropicResponse('gemini-4-hydrogen-high', raw));
  const aEvents = a.events();
  const streamedBlocks = [];
  for (const event of aEvents) {
    if (event.type === 'content_block_start') streamedBlocks[event.index] = { ...event.content_block };
    if (event.type !== 'content_block_delta') continue;
    const block = streamedBlocks[event.index];
    if (event.delta.type === 'thinking_delta') block.thinking += event.delta.thinking;
    if (event.delta.type === 'signature_delta') block.signature = event.delta.signature;
    if (event.delta.type === 'text_delta') block.text += event.delta.text;
    if (event.delta.type === 'input_json_delta') block.input = JSON.parse(event.delta.partial_json);
  }
  const reparsed = normalizeAnthropic({ model: 'gemini-4-hydrogen-high', messages: [{ role: 'assistant', content: streamedBlocks }] });
  const reparsedCalls = reparsed.messages[0].parts.filter(part => part.type === 'tool_call');
  assert.deepEqual(reparsedCalls.map(call => [call.id, call.arguments, call.thoughtSignature]),
    toolCalls.map(call => [call.id, call.arguments, call.thoughtSignature]));
  assert.equal(aEvents.find(e => e.type === 'message_delta').delta.stop_reason, 'tool_use');

  // Responses live emitter with function_call
  const r = sseHarness();
  const rEmitter = createResponsesTextEmitter(r.res, 'gemini-4-neon-high', 'resp_tool_live');
  rEmitter.onThinkingDelta('先检查');
  rEmitter.onDelta('准备读取');
  rEmitter.finish(responsesResponse('gemini-4-neon-high', raw, 'resp_tool_live'));
  const rEvents = r.events();
  assert.deepEqual(rEvents.map(event => event.sequence_number), rEvents.map((_, i) => i));
  const completed = rEvents.at(-1);
  assert.equal(completed.type, 'response.completed');
  assert.deepEqual(completed.response.output.filter(item => item.type === 'function_call').map(item => item.call_id), ['call_a', 'call_b', 'call_c']);
});

test('instruction envelope is never double-wrapped in USER_REQUEST and keeps thoughtSignature intact across dynamic system updates', async () => {
  const fixture = require('./fixtures/claude-desktop-2.1.330-framework.json');
  const state = newState('acct', 'sess-envelope-dynamic');
  const requests = [];
  const provider = new DirectAntigravityProvider({
    accessToken: 'synthetic', projectId: 'fixture', maxRetries: 0,
    localAuth: { isConfigured: () => false, load: () => ({}) },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length === 1) {
        const decl = body.request.tools.flatMap(t => t.functionDeclarations).find(d => d.name.includes('read_fixture'));
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ functionCall: { id: 'call_1', name: decl.name, args: { path: 'a.txt', toolSummary: 'Read fixture' } }, thoughtSignature: 'real-upstream-signature' }] }, finishReason: 'STOP' }]
        }));
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] }));
    }
  });
  const tools = [{ type: 'function', function: { name: 'read_fixture', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } }];
  const turn1 = normalizeChat({ model: 'gemini-4-hydrogen-sonar', messages: [{ role: 'system', content: fixture.compactSystem + '\nDynamic note: turn 1' }, { role: 'user', content: 'Read a.txt' }], tools });
  const first = await provider.sendInSession(turn1, 'gemini-4-hydrogen-sonar', { sessionId: 's' }, state, () => {});
  assert.equal(first.toolCalls[0].name, 'read_fixture');
  const envelope0 = requests[0].request.contents[0].parts[0].text;
  assert.ok(envelope0.startsWith(`${OPEN}\n`) && envelope0.endsWith(`\n${CLOSE}`), 'envelope must stay clean without USER_REQUEST wrapper');
  assert.ok(!envelope0.includes('<USER_REQUEST>'));

  // Turn 2 updates system prompt dynamically; history signature must still restore from state instead of sentinel
  const turn2 = normalizeChat({
    model: 'gemini-4-hydrogen-sonar',
    messages: [
      { role: 'system', content: fixture.compactSystem + '\nDynamic note: turn 2 changed memory' },
      { role: 'user', content: 'Read a.txt' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_fixture', arguments: '{"path":"a.txt"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'contents of a.txt' }
    ],
    tools
  });
  await provider.sendInSession(turn2, 'gemini-4-hydrogen-sonar', { sessionId: 's' }, state, () => {});
  const callPart = requests[1].request.contents.flatMap(c => c.parts).find(p => p.functionCall);
  assert.equal(callPart.thoughtSignature, 'real-upstream-signature');
  assert.ok(requests[1].request.contents[0].parts[0].text.includes('turn 2 changed memory'));
});

test('MCP compatibility tool names carry readable slugs, stay <= 64 chars, and tolerate fenced argumentsJson', () => {
  const schema = { type: 'object', properties: { path: { type: 'string' } }, patternProperties: { '^x_': { type: 'boolean' } }, required: ['path'], additionalProperties: false };
  const adapter = prepareAntigravityTools({
    tools: [
      { name: 'Bash', kind: 'function', description: 'Run shell', schema: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'], additionalProperties: false } },
      { name: 'VeryLongToolName_WithSpecialChars-1234567890-ExtraTail', kind: 'function', description: 'Complex tool', schema }
    ]
  });
  for (const decl of adapter.declarations) {
    assert.ok(decl.name.length <= 64, `tool name exceeded 64 chars: ${decl.name}`);
  }
  const bashName = adapter.toProviderName('Bash');
  assert.match(bashName, /^mcp_gateway_tool_bash_[a-f0-9]{16}$/);
  const response = attachClientToolResult({ name: bashName, response: { output: 'ok' } }, { content: 'ok' }, 'ok');
  assert.equal(createToolReceiptTransform(response, bashName, adapter).mode, 'mcp');

  const jsonName = adapter.toProviderName('VeryLongToolName_WithSpecialChars-1234567890-ExtraTail');
  assert.match(jsonName, /^mcp_gateway_tool_verylongtoolname_withspe_[a-f0-9]{16}_json$/);
  const fenced = adapter.toClient({
    id: 'c1', name: jsonName,
    arguments: { argumentsJson: '```json\n{"path":"/tmp/ok","x_flag":true}\n```', toolSummary: 'Complex check' }
  });
  assert.deepEqual(fenced.arguments, { path: '/tmp/ok', x_flag: true });
  assert.throws(() => adapter.toClient({
    id: 'c2', name: jsonName,
    arguments: { argumentsJson: '```json\n{"path":123}\n```', toolSummary: 'Invalid check' }
  }), /原始客户端契约/);
});

test('Gemini 4 thinking models enforce a 1024-token floor on small maxOutputTokens budgets', () => {
  const normalized = normalizeChat({ model: 'gemini-4-neon-high', max_tokens: 128, messages: [{ role: 'user', content: 'Hi' }] });
  const wire = buildDirectRequest(normalized, 'gemini-4-neon-high', 'p', 's', '', null, {
    modelInfo: { supportsThinking: true, thinkingLevel: 3, maxOutputTokens: 65536 }
  });
  assert.equal(wire.request.generationConfig.maxOutputTokens, 1024);

  const nonThinking = buildDirectRequest(normalized, 'gemini-4-plain', 'p', 's', '', null, {
    modelInfo: { supportsThinking: false, maxOutputTokens: 65536 }
  });
  assert.equal(nonThinking.request.generationConfig.maxOutputTokens, 128);
});

test('Codex neutral catalog template is reachable with live CODEX_CLIENT_PROFILE', () => {
  const normalized = normalizeResponses({
    model: 'gemini-4-hydrogen-high',
    input: [
      { role: 'developer', content: 'Follow the client instructions and use only client-provided tools when needed.' },
      { role: 'user', content: 'Hello' }
    ]
  });
  const sanitized = sanitizeClientIdentity(normalized, { clientProfile: CODEX_CLIENT_PROFILE });
  assert.equal(sanitized.metadata.profile?.client, 'codex');
  assert.ok(sanitized.metadata.profile.evidence.includes('codex-neutral-catalog-template'));
});

test('Responses compaction items support plaintext summaries and reject opaque encrypted_content clearly', () => {
  const plain = normalizeResponses({
    model: 'gemini-4-neon-high',
    input: [
      { type: 'compaction', summary: 'Earlier turns decided on architecture B.' },
      { role: 'user', content: 'Continue implementing.' }
    ]
  });
  assert.equal(plain.messages.length, 2);
  assert.equal(plain.messages[0].text, '<CONTEXT_SUMMARY>\nEarlier turns decided on architecture B.\n</CONTEXT_SUMMARY>');
  const wire = buildDirectRequest(plain, 'gemini-4-neon-high', 'p', 's');
  assert.equal(wire.request.contents[0].parts[0].text, '<CONTEXT_SUMMARY>\nEarlier turns decided on architecture B.\n</CONTEXT_SUMMARY>');

  assert.throws(() => normalizeResponses({
    model: 'gemini-4-neon-high',
    input: [{ type: 'compaction', encrypted_content: 'gAAAAABopaque_blob' }]
  }), error => error.status === 400 && error.code === 'unsupported_encrypted_compaction');
});

test('conversion summary logs sanitized identityProfile, envelopeApplied, toolViews and schemaCache without private data', () => {
  const fixture = require('./fixtures/claude-desktop-2.1.330-framework.json');
  const entry = { schemaCacheHits: 3, schemaCacheMisses: 1 };
  const secretToolName = 'PRIVATE_TOOL_SECRET_XYZ';
  const normalized = normalizeChat({
    model: 'gemini-4-hydrogen-sonar',
    messages: [{ role: 'system', content: fixture.compactSystem }, { role: 'user', content: 'PRIVATE_USER_PAYLOAD' }],
    tools: [{ type: 'function', function: { name: secretToolName, parameters: { type: 'object', properties: { a: { type: 'string' } } } } }]
  });
  runRequestLog(entry, () => buildDirectRequest(normalized, 'gemini-4-hydrogen-sonar', 'p', 's'));
  assert.equal(entry.conversion.identityProfile, 'claude');
  assert.equal(entry.conversion.envelopeApplied, true);
  assert.deepEqual(entry.conversion.toolViews, { direct: 1, json: 1, native: 0, service: 0, legacy: 0 });
  assert.deepEqual(entry.conversion.schemaCache, { hits: 3, misses: 1 });
  const serialized = JSON.stringify(entry.conversion);
  assert.ok(!serialized.includes(secretToolName));
  assert.ok(!serialized.includes('PRIVATE_USER_PAYLOAD'));
});

test('silent empty upstream stream without finishReason fails explicitly as 502 empty_upstream_response', async () => {
  const diagnostics = [];
  const sseBody = 'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thoughtSignature":"sig-only","text":""}]}}],"usageMetadata":{"promptTokenCount":100,"totalTokenCount":100}}}\n\n';
  const provider = new DirectAntigravityProvider({
    accessToken: 'synthetic', projectId: 'fixture', maxRetries: 0,
    localAuth: { isConfigured: () => false, load: () => ({}) },
    diagnosticReporter: (event, fields) => diagnostics.push({ event, fields }),
    fetchImpl: async () => new Response(sseBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  });
  const entry = {};
  await assert.rejects(
    runRequestLog(entry, () => provider.sendInSession(
      normalizeChat({ model: 'gemini-4-hydrogen-sonar', messages: [{ role: 'user', content: 'Hi' }] }),
      'gemini-4-hydrogen-sonar', { sessionId: 'empty-test' }, newState('acct', 'empty-test'), () => {}
    )),
    error => error.status === 502 && error.code === 'empty_upstream_response'
  );
  assert.equal(entry.emptyUpstreamResponse, true);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].event, 'empty_upstream_response');
  assert.equal(diagnostics[0].fields.hasSignature, true);

  // Explicit STOP with empty text remains accepted (no false positive on deliberate empty STOP)
  const stopProvider = new DirectAntigravityProvider({
    accessToken: 'synthetic', projectId: 'fixture', maxRetries: 0,
    localAuth: { isConfigured: () => false, load: () => ({}) },
    fetchImpl: async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"STOP"}]}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } })
  });
  const ok = await stopProvider.sendInSession(
    normalizeChat({ model: 'gemini-4-hydrogen-sonar', messages: [{ role: 'user', content: 'Hi' }] }),
    'gemini-4-hydrogen-sonar', { sessionId: 'stop-test' }, newState('acct', 'stop-test'), () => {}
  );
  assert.equal(ok.finishReason, 'STOP');
});

