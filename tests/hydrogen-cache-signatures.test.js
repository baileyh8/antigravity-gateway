'use strict';
require('./helpers/gateway-environment');
delete process.env.ANTIGRAVITY_TOOL_CONTRACT;
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { DirectAntigravityProvider } = require('../src/direct-provider');
const { AgySessionStore, newState, recordResponse, restoreHistory } = require('../src/agy-session-state');
const { normalizeResponses, normalizeChat, normalizeAnthropic, responsesResponse, chatResponse, anthropicResponse } = require('../src/protocol');
const marker = 'skip_thought_signature_validator';
const modelIds = ['gemini-3.8-flash-high', ...['low', 'medium', 'high', 'xhigh'].map(x => 'gemini-4-hydrogen-' + x)];
const schema = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false };
function fixture(protocol) {
  const payload = protocol === 'responses' ? { input: [{ role: 'user', content: 'Synthetic staged work' }], tools: [{ type: 'function', name: 'external_step', parameters: schema }] }
    : { messages: [{ role: 'user', content: 'Synthetic staged work' }], tools: protocol === 'chat'
      ? [{ type: 'function', function: { name: 'external_step', parameters: schema } }]
      : [{ name: 'external_step', input_schema: schema }] };
  const normalize = { responses: normalizeResponses, chat: normalizeChat, anthropic: normalizeAnthropic }[protocol];
  function append(result, signedOverride = '') {
    const call = result.toolCalls[0];
    if (protocol === 'responses') {
      const output = responsesResponse('fixture', result, 'resp_' + call.id).output;
      if (signedOverride) output.find(c => c.type === 'function_call').extra_content = { google: { thought_signature: signedOverride } };
      payload.input.push(...output, { type: 'function_call_output', call_id: call.id, output: 'RECEIPT_' + call.id });
    } else if (protocol === 'chat') {
      const message = chatResponse('fixture', result).choices[0].message;
      if (signedOverride) message.tool_calls[0].extra_content = { google: { thought_signature: signedOverride } };
      payload.messages.push(message, { role: 'tool', tool_call_id: call.id, content: 'RECEIPT_' + call.id });
    } else {
      const content = anthropicResponse('fixture', result).content;
      if (signedOverride) content.unshift({ type: 'thinking', thinking: '', signature: signedOverride });
      payload.messages.push({ role: 'assistant', content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: 'RECEIPT_' + call.id }] });
    }
  }
  return { payload, normalize, append };
}

for (const model of modelIds) for (const protocol of ['responses', 'chat', 'anthropic']) {
  test(`${model}/${protocol}: a fourth unsigned cached call survives restart and full native projection restoration`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cached-signature-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const f = fixture(protocol), seen = [];
    for (let turn = 1; turn <= 5; turn++) {
      const provider = new DirectAntigravityProvider({ localAuth: null, accessToken: 'synthetic', projectId: 'fixture-project', maxRetries: 0,
        sessionStore: new AgySessionStore({ directory }), fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);seen.push(body);
          const calls = body.request.contents.flatMap(c => c.parts).filter(p => p.functionCall);
          assert.equal(calls.length, turn - 1);
          for (const [i,p] of calls.entries()) {
            assert.equal(p.thoughtSignature, i < 3 ? 'genuine-' + (i+1) : marker, `turn ${turn}, call ${i+1}`);
            assert.equal(p.functionCall.id, 'step-' + (i+1));
          }
          const nativeName = body.request.tools.flatMap(t => t.functionDeclarations).find(t => t.name.startsWith('mcp_gateway_')).name;
          const parts = turn < 5 ? [{ functionCall: { id: 'step-' + turn, name: nativeName, args: { argumentsJson: JSON.stringify({ value: String(turn) }), toolSummary: 'Synthetic step' } },
            ...(turn < 4 ? { thoughtSignature: 'genuine-' + turn } : {}) }] : [{ text: 'DONE' }];
          return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }));
        } });
      const result = await provider.send(f.normalize(f.payload), model, { sessionId: 'same-staged-session' });
      if (turn < 5) f.append(result);else assert.equal(result.text, 'DONE');
    }
    assert.equal(seen.length, 5, 'no hidden retries');
  });
}

for (const protocol of ['responses', 'chat', 'anthropic']) test(`${protocol}: valid client signature wins over an exact unsigned native cache entry`, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-client-signature-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const f = fixture(protocol), seen = [];
  for (let turn = 0; turn < 2; turn++) {
    const provider = new DirectAntigravityProvider({ localAuth: null, accessToken: 'synthetic', projectId: 'fixture-project', maxRetries: 0,
      sessionStore: new AgySessionStore({ directory }), fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);seen.push(body);
        if (turn) {
          const call = body.request.contents.flatMap(c => c.parts).find(p => p.functionCall);
          assert.equal(call.thoughtSignature, 'explicit-client-signature');
          assert.equal(call.functionCall.id, 'unsigned-step');
        }
        const name = body.request.tools.flatMap(t => t.functionDeclarations).find(t => t.name.startsWith('mcp_gateway_')).name;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: turn ? [{ text: 'DONE' }] : [
          { functionCall: { id: 'unsigned-step', name, args: { argumentsJson: '{"value":"fixture"}', toolSummary: 'Fixture' } } }] } }] }));
      } });
    const result = await provider.send(f.normalize(f.payload), 'gemini-4-hydrogen-xhigh', { sessionId: 'explicit-signed-session' });
    if (!turn) f.append(result, 'explicit-client-signature');else assert.equal(result.text, 'DONE');
  }
});

test('exact response restoration preserves explicit signature without changing stored native parts', () => {
  const model = 'gemini-4-hydrogen-xhigh', state = newState('fixture-owner', 'fixture-session');
  const prefix = [{ role: 'user', parts: [{ text: 'Synthetic input' }] }];
  const content = { role: 'model', parts: [{ functionCall: { id: 'call', name: 'external_step', args: { value: 'x' } } }] };
  recordResponse(state, prefix, model, content);
  const before = JSON.stringify(state), signed = structuredClone(content);signed.parts[0].thoughtSignature = 'client-signature';
  const restored = restoreHistory(state, [...prefix, signed], model);
  assert.equal(restored[1].parts[0].thoughtSignature, 'client-signature');assert.equal(JSON.stringify(state), before);
});

test('an issued genuine signature takes priority over conflicting client metadata', () => {
  const model = 'gemini-4-hydrogen-xhigh', state = newState('fixture-owner', 'fixture-session');
  const prefix = [{ role: 'user', parts: [{ text: 'Synthetic input' }] }];
  const native = { role: 'model', parts: [{ functionCall: { id: 'call', name: 'external_step', args: {} }, thoughtSignature: 'issued-signature' }] };
  recordResponse(state, prefix, model, native);
  const submitted = structuredClone(native);submitted.parts[0].thoughtSignature = 'different-client-value';
  assert.equal(restoreHistory(state, [...prefix, submitted], model)[1].parts[0].thoughtSignature, 'issued-signature');
});

test('duplicate call IDs cannot assign a client signature to ambiguous cached calls', () => {
  const model = 'gemini-4-hydrogen-xhigh', state = newState('fixture-owner', 'fixture-session');
  const prefix = [{ role: 'user', parts: [{ text: 'Synthetic input' }] }];
  const native = { role: 'model', parts: [1,2].map(value => ({ functionCall: { id: 'duplicate', name: 'external_step', args: { value } } })) };
  recordResponse(state, prefix, model, native);
  const submitted = structuredClone(native);submitted.parts[0].thoughtSignature = 'ambiguous-client-value';
  assert.ok(restoreHistory(state, [...prefix, submitted], model)[1].parts.every(p => p.thoughtSignature === undefined));
});
