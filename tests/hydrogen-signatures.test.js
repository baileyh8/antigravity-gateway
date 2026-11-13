'use strict';
require('./helpers/gateway-environment');
delete process.env.ANTIGRAVITY_TOOL_CONTRACT;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { normalizeResponses, normalizeChat, normalizeAnthropic, responsesResponse, chatResponse, anthropicResponse } = require('../src/protocol');
const { buildDirectRequest, DirectAntigravityProvider } = require('../src/direct-provider');
const { AgySessionStore } = require('../src/agy-session-state');
const { createResponsesTextEmitter, createChatTextEmitter, emitResponsesStream, emitChatStream } = require('../antigravity-gateway');
const signature = Buffer.from('synthetic upstream signature + / =').toString('base64');
const models = ['low', 'medium', 'high', 'xhigh'].map(tier => 'gemini-4-hydrogen-' + tier);
const args = { command: 'literal $() ` text', timeout: 17 };
const tool = { type: 'function', name: 'execute', description: 'Execute with the client time limit.', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'], additionalProperties: false } };
const user = { role: 'user', content: 'Run the synthetic command.' };
const wireCall = extra => ({ type: 'function_call', call_id: 'fixture-call', name: 'execute', arguments: JSON.stringify(args), ...extra });
const receipt = { type: 'function_call_output', call_id: 'fixture-call', output: 'SYNTHETIC_RECEIPT' };
const normalizedCalls = n => n.messages.flatMap(m => m.parts || []).filter(p => p.type === 'tool_call');
const allParts = request => request.request.contents.flatMap(c => c.parts);

for (const protocol of ['responses', 'chat', 'anthropic']) test(`${protocol}: the public wire carries a genuine per-call signature out and back`, () => {
  const result = { text: '', thinking: '', toolCalls: [{ id: 'fixture-call', name: 'execute', arguments: args, thoughtSignature: signature }], usage: {} };
  const serialized = protocol === 'responses' ? responsesResponse(models[3], result, 'resp_fixture') : protocol === 'chat' ? chatResponse(models[3], result) : anthropicResponse(models[3], result);
  const n = protocol === 'responses' ? normalizeResponses({ input: serialized.output })
    : protocol === 'chat' ? normalizeChat({ messages: [serialized.choices[0].message] })
    : normalizeAnthropic({ messages: [{ role: 'assistant', content: serialized.content }] });
  const call = normalizedCalls(n)[0];
  assert.equal(call.thoughtSignature, signature);
  assert.equal(call.id, 'fixture-call');assert.equal(call.name, 'execute');assert.deepEqual(call.arguments, args);
  if (protocol !== 'anthropic') {
    const item = protocol === 'responses' ? serialized.output[0] : serialized.choices[0].message.tool_calls[0];
    assert.equal(item.extra_content.google.thought_signature, signature);
  }
});

for (const extra of [{ thoughtSignature: signature }, { thought_signature: signature }, { extra_content: { google: { thought_signature: signature } } }]) {
  test(`Responses input accepts ${Object.keys(extra)[0]} without altering the opaque signature`, () => {
    const payload = { input: [user, wireCall(extra), receipt], tools: [tool] }, before = JSON.stringify(payload);
    const n = normalizeResponses(payload);
    assert.equal(normalizedCalls(n)[0].thoughtSignature, signature);
    const sent = allParts(buildDirectRequest(n, models[3], 'fixture-project', 'fixture-session'));
    assert.equal(sent.find(p => p.functionCall).thoughtSignature, signature);
    assert.equal(JSON.stringify(payload), before);
  });
}

test('Responses custom calls retain signature metadata and literal freeform input', () => {
  const literal = '*** Begin Patch\n+literal $()` text\n*** End Patch';
  const result = { text: '', toolCalls: [{ id: 'custom-1', kind: 'custom', name: 'apply_patch', arguments: { input: literal }, input: literal, thoughtSignature: signature }] };
  const output = responsesResponse(models[3], result, 'resp_custom').output;
  assert.equal(output[0].extra_content.google.thought_signature, signature);
  const call = normalizedCalls(normalizeResponses({ input: output }))[0];
  assert.equal(call.thoughtSignature, signature);assert.equal(call.kind, 'custom');assert.equal(call.arguments.input, literal);
});

for (const protocol of ['responses', 'chat']) for (const live of [false, true]) test(`${protocol}: ${live ? 'live' : 'buffered'} SSE delivers signature metadata on completed tool calls`, () => {
  const frames = [], res = { writeHead() { this.headersSent = true; }, write(chunk) { frames.push(chunk);return true; }, end() {} };
  const result = { text: '', toolCalls: [{ id: 'fixture-call', name: 'execute', arguments: args, thoughtSignature: signature }], usage: {} };
  const body = protocol === 'responses' ? responsesResponse(models[3], result, 'resp_fixture') : chatResponse(models[3], result);
  if (live) {
    const emitter = protocol === 'responses' ? createResponsesTextEmitter(res, models[3], 'resp_fixture') : createChatTextEmitter(res, models[3]);
    emitter.finish(body);
  } else (protocol === 'responses' ? emitResponsesStream : emitChatStream)(res, body);
  const events = frames.join('').split('\n').filter(s => s.startsWith('data: {')).map(s => JSON.parse(s.slice(6)));
  const item = protocol === 'responses' ? events.find(e => e.type === 'response.output_item.done').item
    : events.flatMap(e => e.choices || []).find(c => c.delta?.tool_calls)?.delta.tool_calls[0];
  assert.equal(item.extra_content.google.thought_signature, signature);
  if (protocol === 'responses') assert.equal(events.at(-1).response.output[0].extra_content.google.thought_signature, signature);
});

test('parallel signatures remain attached to their own calls and malformed oversized values are ignored', () => {
  const secondSignature = Buffer.from('a different synthetic signature').toString('base64');
  const result = { text: '', toolCalls: [{ id: 'a', name: 'execute', arguments: args, thoughtSignature: signature },
    { id: 'b', name: 'execute', arguments: args, thoughtSignature: secondSignature }] };
  const wire = responsesResponse(models[3], result, 'resp_parallel').output;
  assert.deepEqual(normalizedCalls(normalizeResponses({ input: wire })).map(c => [c.id, c.thoughtSignature]), [['a', signature], ['b', secondSignature]]);
  for (const invalid of ['é'.repeat(40000), '\ud83d\ude42'.repeat(20000)]) {
    assert.equal(normalizedCalls(normalizeResponses({ input: [wireCall({ extra_content: { google: { thought_signature: invalid } } })] }))[0].thoughtSignature, undefined);
  }
});

for (const model of models) test(`${model}: unsigned imported history signs only the first parallel call with the compatibility marker`, () => {
  const payload = { input: [user, wireCall({}), { ...wireCall({}), call_id: 'parallel-2' }, receipt,
    { ...receipt, call_id: 'parallel-2' }], tools: [tool] };
  const calls = allParts(buildDirectRequest(normalizeResponses(payload), model, 'p', 's')).filter(p => p.functionCall);
  assert.equal(calls[0].thoughtSignature, 'skip_thought_signature_validator');
  assert.equal(calls[1].thoughtSignature, undefined);
  assert.deepEqual(calls.map(p => p.functionCall.id), ['fixture-call', 'parallel-2']);
});

test('signature fields are bounded strings and never come from call IDs or user arguments', () => {
  for (const invalid of [17, {}, [], true, 'x'.repeat(65537)]) {
    const item = wireCall({ thoughtSignature: invalid, arguments: JSON.stringify({ ...args, thoughtSignature: signature }) });
    assert.equal(normalizedCalls(normalizeResponses({ input: [item] }))[0].thoughtSignature, undefined);
  }
  for (const model of ['claude-opus-5.5-high', 'gpt-oss-120b-medium']) {
    assert.equal(allParts(buildDirectRequest(normalizeResponses({ input: [wireCall({})] }), model, 'p', 's'))[0].thoughtSignature, undefined);
  }
});

test('Hydrogen tool projection restores genuine signed parts after restart, while a new account receives no private cached history', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrogen-signatures-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const seen = [];
  async function send(payload, account, replyCall = false) {
    const provider = new DirectAntigravityProvider({ sessionStore: new AgySessionStore({ directory }), accessToken: 'synthetic', projectId: 'fixture-project', maxRetries: 0,
      localAuth: { isConfigured: () => false, load: () => ({ sourcePath: 'managed-account:' + account }) },
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);seen.push(body);
        const name = body.request.tools.flatMap(t => t.functionDeclarations).find(t => t.name.startsWith('mcp_gateway_')).name;
        const parts = replyCall ? [{ functionCall: { id: 'fixture-call', name, args: { argumentsJson: JSON.stringify(args), toolSummary: 'Fixture' } }, thoughtSignature: signature }] : [{ text: 'DONE' }];
        return new Response(JSON.stringify({ candidates: [{ content: { parts } }] }));
      } });
    return provider.send(normalizeResponses(payload), models[3], { sessionId: 'fixture-session' });
  }
  const payload = { model: models[3], input: [user], tools: [tool] };
  const first = await send(payload, 'account-A', true);
  assert.equal(first.toolCalls[0].thoughtSignature, signature);
  const echoed = responsesResponse(models[3], first, 'resp_fixture').output;
  const unsigned = JSON.parse(JSON.stringify(echoed));for (const c of unsigned) delete c.extra_content;
  await send({ ...payload, input: [user, ...unsigned, receipt] }, 'account-A');
  assert.equal(allParts(seen.at(-1)).find(p => p.functionCall).thoughtSignature, signature, 'exact persisted projection restores the genuine signature');
  await send({ ...payload, input: [user, ...unsigned, receipt] }, 'account-B');
  assert.equal(allParts(seen.at(-1)).find(p => p.functionCall).thoughtSignature, 'skip_thought_signature_validator');
  assert.doesNotMatch(JSON.stringify(seen.at(-1)), new RegExp(signature));
  await send({ ...payload, input: [user, ...echoed, receipt] }, 'account-C');
  const call = allParts(seen.at(-1)).find(p => p.functionCall);
  assert.equal(call.thoughtSignature, signature, 'explicit client-carried signature survives an empty cache');
  assert.equal(call.functionCall.id, 'fixture-call');
  const result = allParts(seen.at(-1)).find(p => p.functionResponse);
  assert.equal(call.functionCall.name, result.functionResponse.name);
});
