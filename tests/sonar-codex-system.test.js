'use strict';
require('./helpers/gateway-environment');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const capture = require('../src/data/codex-0.169.0-framework.json');
const { normalizeResponses } = require('../src/protocol');
const { sanitizeClientIdentity } = require('../src/client-identity');
const { buildDirectRequest, buildDirectRequestAsync } = require('../src/direct-provider');
const { closeSchemaWorkers } = require('../src/schema-contract');
test.after(closeSchemaWorkers);
const model = 'gemini-4-hydrogen-sonar';
const options = { model, clientProfile: 'codex-exec-0.159.2' };
// Do not publish the captured policy text. Synthetic vectors exercise matching
// boundaries; live acceptance separately verifies the actual captured digest.
const template = (capture.identity + '\n\n' + 'Synthetic framework policy. '.repeat(capture.length)).slice(0, capture.length);
const catalog = capture.catalogInstructions;
const catalogTemplate = (catalog.identity + 'Synthetic stock catalog instructions. '.repeat(catalog.length)).slice(0, catalog.length - 1) + '\n';
const extraTemplates = capture.additionalFrameworks.map(item =>
  (('Synthetic prefix. '.repeat(item.identityOffset)).slice(0, item.identityOffset)
    + item.identity + 'Synthetic variant policy. '.repeat(item.length)).slice(0, item.length));
function mockCapturedDigest(t) {
  const createHash = crypto.createHash;
  t.mock.method(crypto, 'createHash', (...args) => {
    const hash = createHash(...args), update = hash.update.bind(hash), digest = hash.digest.bind(hash);
    let fixture = null;
    hash.update = (value, ...rest) => { fixture = value === template ? capture.sha256
      : value === catalogTemplate ? catalog.sha256 : capture.additionalFrameworks[extraTemplates.indexOf(value)]?.sha256; update(value, ...rest); return hash; };
    hash.digest = encoding => fixture && encoding === 'hex' ? fixture : digest(encoding);
    return hash;
  });
}
function payload() {
  return { model, instructions: 'Top-level client instructions must remain highest priority.',
    input: [
      { role: 'developer', content: template + '\nAPPENDED_USER_RULE: Ask before publishing.' },
      { role: 'developer', content: 'PROJECT_PERMISSION: Only edit the fixture.' },
      { role: 'user', content: 'Quoted text: ' + capture.identity }
    ],
    tools: [{ type: 'function', name: 'read_note', description: 'Read a fixture.', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } }],
    reasoning: { effort: 'high' } };
}

test('Sonar normalizes only the verified framework identity and preserves all client instruction layers', t => {
  mockCapturedDigest(t);
  const normalized = normalizeResponses(payload()), before = structuredClone(normalized);
  const { normalized: result, metadata } = sanitizeClientIdentity(normalized, options);
  assert.deepEqual(normalized, before);
  const expected = structuredClone(before);
  expected.instructionMessages[0].text = capture.replacement + before.instructionMessages[0].text.slice(capture.identity.length);
  expected.system = [expected.instructions, ...expected.instructionMessages.map(m => m.text)].filter(Boolean).join('\n\n');
  assert.deepEqual(result, expected);
  assert.match(result.system, /^Top-level client instructions/);
  assert.match(result.system, /APPENDED_USER_RULE: Ask before publishing/);
  assert.match(result.system, /PROJECT_PERMISSION/);
  assert.equal(result.messages[0].text, 'Quoted text: ' + capture.identity);
  assert.deepEqual(metadata.rules, ['codex-169-framework-model-identity']);
  assert.equal(metadata.frameworkVersion, capture.version);
  assert.equal(metadata.profile, null, 'an instruction edit must not select a new tool-mapping profile');
});

test('the verified catalog fallback is recognized in top-level instructions only', async t => {
  mockCapturedDigest(t);
  const model = 'gemini-4-carbon-medium';
  const payloadWithCatalog = { ...payload(), model, instructions: catalogTemplate,
    input: [{ role: 'developer', content: 'Keep the project and permission instructions.' },
      { role: 'user', content: 'Keep this quote: ' + catalog.identity }] };
  const normalized = normalizeResponses(payloadWithCatalog);
  const hints = { ...options, model };
  const { normalized: compatible, metadata } = sanitizeClientIdentity(normalized, hints);
  const expected = catalog.replacement + catalogTemplate.slice(catalog.identity.length);
  assert.equal(compatible.instructions, expected);
  assert.deepEqual(compatible.instructionMessages, normalized.instructionMessages);
  assert.deepEqual(compatible.messages, normalized.messages);
  assert.deepEqual(compatible.tools, normalized.tools);
  assert.equal(metadata.editedTopLevelInstructions, true);
  assert.deepEqual(metadata.editedInstructionBlocks, []);
  const native = { identityClientProfile: options.clientProfile,
    modelInfo: { maxOutputTokens: 262144, supportsThinking: true, thinkingLevel: 2 } };
  const wire = await buildDirectRequestAsync(normalized, model, 'project', 'session', '', null, native);
  assert.ok(wire.request.systemInstruction.parts[0].text.startsWith(expected));
  assert.deepEqual(wire.request.generationConfig.thinkingConfig, { includeThoughts: true, thinkingLevel: 'MEDIUM' });
  for (const candidate of [
    normalizeResponses({ ...payloadWithCatalog, instructions: catalogTemplate + '\nProject-specific policy' }),
    normalizeResponses({ ...payloadWithCatalog, instructions: catalogTemplate.slice(0, -1) + 'X' }),
    normalizeResponses({ ...payloadWithCatalog, instructions: '', input: [{ role: 'developer', content: catalogTemplate }] }),
    { ...normalized, system: 'A different projection' }
  ]) {
    assert.deepEqual(sanitizeClientIdentity(candidate, hints).normalized, candidate);
  }
  assert.deepEqual(sanitizeClientIdentity(normalized,{ ...hints, clientProfile: 'unknown-client' }).normalized, normalized);
});

test('unverified templates, mismatched provenance and other protocols remain untouched', t => {
  mockCapturedDigest(t);
  const baseline = normalizeResponses(payload());
  const vectors = [
    [baseline, { ...options, clientProfile: '' }],
    [baseline, { ...options, clientProfile: 'unknown-client' }],
    [{ ...baseline, protocol: 'chat' }, options],
    [{ ...baseline, system: 'a forged flattened projection' }, options],
    [normalizeResponses({ ...payload(), input: [{ role: 'developer', content: template.slice(0, -1) + '!' }] }), options],
    [normalizeResponses({ ...payload(), input: [{ role: 'developer', content: capture.identity }] }), options],
    [normalizeResponses({ ...payload(), input: [{ role: 'system', content: template }] }), options],
    [normalizeResponses({ ...payload(), input: [{ role: 'user', content: template }] }), options]
  ];
  for (const [normalized, hints] of vectors) {
    const before = structuredClone(normalized), result = sanitizeClientIdentity(normalized, hints);
    assert.deepEqual(result.normalized, before);
    assert.ok(!result.metadata.rules.includes('codex-169-framework-model-identity'));
  }
});

test('the direct request path receives the actual model and leaves tools and generation settings unchanged', t => {
  mockCapturedDigest(t);
  const normalized = normalizeResponses(payload());
  const manual = normalizeResponses({ ...payload(), input: payload().input.map((item, i) => i ? item : {
    ...item, content: capture.replacement + item.content.slice(capture.identity.length)
  }) });
  const native = { identityClientProfile: options.clientProfile, modelInfo: { model: 'SYNTHETIC_SONAR', maxOutputTokens: 65536, supportsThinking: true, thinkingLevel: 1 } };
  const automatic = buildDirectRequest(normalized, model, 'project', 'session', '', null, native);
  const reference = buildDirectRequest(manual, model, 'project', 'session', '', null, native);
  assert.equal(automatic.model, model);
  assert.equal(automatic.request.systemInstruction.parts[0].text, reference.request.systemInstruction.parts[0].text);
  assert.deepEqual(automatic.request.tools, reference.request.tools);
  assert.deepEqual(automatic.request.generationConfig, reference.request.generationConfig);
  assert.equal(automatic.request.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
  assert.match(automatic.request.systemInstruction.parts[0].text, /PROJECT_PERMISSION/);
});

test('relayed Codex HTTP requests apply the same framework rule across current and discovered models', async t => {
  mockCapturedDigest(t);
  process.env.ANTIGRAVITY_GATEWAY_TRANSPORT = 'direct';
  const { AccountPool } = require('../src/account-pool');
  const { ProviderRouter } = require('../src/provider-router');
  const { createServer } = require('../antigravity-gateway');
  const metadata = { model: 'SYNTHETIC_SONAR', maxTokens: 1048576, maxOutputTokens: 65536, supportsThinking: true, thinkingLevel: 2 };
  t.mock.method(AccountPool.prototype, 'listModels', async () => [model]);
  t.mock.method(AccountPool.prototype, 'modelInfo', () => metadata);
  let seen;
  t.mock.method(ProviderRouter.prototype, 'send', async (normalized, resolved, hints) => {
    seen = await buildDirectRequestAsync(normalized, resolved, 'project', 'session', '', null,
      { identityClientProfile: hints.nativeClientProfile, modelInfo: metadata });
    return { text: 'OK', toolCalls: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, finishReason: 'STOP' };
  });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const cases = [
    [model, { thinkingLevel: 'HIGH' }],
    ['gemini-4-carbon-medium', { thinkingLevel: 'MEDIUM' }],
    ['gemini-4-hydrogen-xhigh', { thinkingLevel: 100 }],
    ['gemini-4-argon-high', { thinkingLevel: 'HIGH' }],
    ['gemini-pro-orchestrator-argon', { thinkingLevel: 'MEDIUM' }],
    ['claude-sonnet-4-6', { thinkingBudget: 1024 }],
    ['gpt-oss-120b-medium', { thinkingBudget: 8192 }],
    ['newly-discovered-model', { thinkingLevel: 'MEDIUM' }]
  ];
  for (const [routeModel, thinking] of cases) {
    const requestBody = { ...payload(), model: routeModel };
    requestBody.input.splice(1, 0, ...extraTemplates.map(content => ({ role: 'developer', content })));
    requestBody.input.push({ type: 'function_call', name: 'read_note', call_id: 'fixture', arguments: '{"key":"literal"}',
      extra_content: { google: { thought_signature: 'fixture-signature' } } },
    { type: 'function_call_output', call_id: 'fixture', output: 'FIXTURE_RECEIPT' });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json', originator: 'Codex Desktop', 'user-agent': 'Codex Desktop/0.169.0-alpha.11.1' },
      body: JSON.stringify(requestBody)
    });
    assert.equal(response.status, 200);
    const system = seen.request.systemInstruction.parts[0].text;
    assert.match(system, /^Top-level client instructions/);
    assert.ok(system.includes(capture.replacement), routeModel);
    assert.ok(!system.includes(capture.identity), routeModel);
    assert.ok(!system.includes(capture.additionalFrameworks[1].identity), routeModel);
    assert.equal(seen.model, routeModel);
    assert.deepEqual(seen.request.generationConfig.thinkingConfig, { includeThoughts: true, ...thinking }, routeModel);
    assert.ok(JSON.stringify(seen.request.contents).includes(capture.identity), 'a user quote remains literal history');
    const parts = seen.request.contents.flatMap(content => content.parts);
    const call = parts.find(part => part.functionCall);
    const receipt = parts.find(part => part.functionResponse);
    assert.equal(call.thoughtSignature, 'fixture-signature');
    assert.equal(call.functionCall.args.key, 'literal');
    assert.equal(receipt.functionResponse.name, call.functionCall.name);
    assert.equal(receipt.functionResponse.id, call.functionCall.id);
  }
});


test('Carbon handles all verified repeated frameworks without changing rules, history or tool mapping', t => {
  mockCapturedDigest(t);
  for (const effort of ['low', 'medium', 'high']) {
    const modelId = `gemini-4-carbon-${effort}`;
    const body = payload();body.model = modelId;
    body.input.splice(1, 0, ...extraTemplates.map(content => ({ role: 'developer', content })));
    const normalized = normalizeResponses(body), before = structuredClone(normalized);
    const result = sanitizeClientIdentity(normalized, { ...options, model: modelId });
    assert.deepEqual(normalized, before);
    assert.deepEqual(result.metadata.editedInstructionBlocks, [0, 1, 2]);
    assert.equal(result.metadata.profile, null);
    for (let index = 0; index < 3; index++) {
      const rule = index ? capture.additionalFrameworks[index - 1] : { ...capture, identityOffset: 0 };
      const original = before.instructionMessages[index].text;
      assert.equal(result.normalized.instructionMessages[index].text,
        original.slice(0, rule.identityOffset) + rule.replacement + original.slice(rule.identityOffset + rule.identity.length));
    }
    assert.deepEqual(result.normalized.messages, before.messages);
    assert.deepEqual(result.normalized.tools, before.tools);
    assert.equal(result.normalized.instructions, before.instructions);
  }
});

test('a modified extra framework remains literal even beside a verified first framework', t => {
  mockCapturedDigest(t);
  const body = payload();body.model = 'gemini-4-carbon-medium';
  const changed = extraTemplates[0].slice(0, -1) + '!';
  body.input.splice(1, 0, { role: 'developer', content: changed });
  const n = normalizeResponses(body), r = sanitizeClientIdentity(n, { ...options, model: body.model });
  assert.deepEqual(r.metadata.editedInstructionBlocks, [0]);
  assert.equal(r.normalized.instructionMessages[1].text, changed);
});
