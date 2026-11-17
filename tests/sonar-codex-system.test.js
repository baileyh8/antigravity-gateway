'use strict';
require('./helpers/gateway-environment');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const capture = require('../src/data/codex-0.169.0-framework.json');
const { normalizeResponses } = require('../src/protocol');
const { sanitizeClientIdentity } = require('../src/client-identity');
const { buildDirectRequest } = require('../src/direct-provider');
const { closeSchemaWorkers } = require('../src/schema-contract');
test.after(closeSchemaWorkers);
const model = 'gemini-4-hydrogen-sonar';
const options = { model, clientProfile: 'codex-exec-0.159.2' };
// Do not publish the captured policy text. Synthetic vectors exercise matching
// boundaries; live acceptance separately verifies the actual captured digest.
const template = (capture.identity + '\n\n' + 'Synthetic framework policy. '.repeat(capture.length)).slice(0, capture.length);
function mockCapturedDigest(t) {
  const createHash = crypto.createHash;
  t.mock.method(crypto, 'createHash', (...args) => {
    const hash = createHash(...args), update = hash.update.bind(hash), digest = hash.digest.bind(hash);
    let fixture = false;
    hash.update = (value, ...rest) => { fixture = value === template; update(value, ...rest); return hash; };
    hash.digest = encoding => fixture && encoding === 'hex' ? capture.sha256 : digest(encoding);
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

test('unverified templates, mismatched provenance and other model routes remain untouched', t => {
  mockCapturedDigest(t);
  const baseline = normalizeResponses(payload());
  const vectors = [
    [baseline, { ...options, model: 'gemini-4-hydrogen-high' }],
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
