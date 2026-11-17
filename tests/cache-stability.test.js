'use strict';
require('./helpers/gateway-environment');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { SessionManager } = require('../src/session-manager');
const { DirectAntigravityProvider, buildDirectRequest } = require('../src/direct-provider');
const { AgySessionStore, newState, rememberTimelineEntries } = require('../src/agy-session-state');
const { completeNativeContext } = require('../src/agy-context-state');
const { closeSchemaWorkers } = require('../src/schema-contract');
const { normalizeResponses, normalizeChat, normalizeAnthropic } = require('../src/protocol');
test.after(closeSchemaWorkers);
const model = 'gemini-4-hydrogen-xhigh';
const user = text => ({ role: 'user', text });
const assistant = text => ({ role: 'assistant', text });
const base = { protocol: 'responses', system: 'Stable synthetic rules.', tools: [] };
const request = headers => ({ headers: { authorization: 'Bearer synthetic', 'user-agent': 'synthetic', ...headers },
  socket: { remoteAddress: '127.0.0.1' } });

test('child threads have private native state and response ownership while retaining root routing affinity', () => {
  const manager = new SessionManager();
  const a = request({ 'session-id': 'root', 'thread-id': 'child-a' });
  const b = request({ 'session-id': 'root', 'thread-id': 'child-b' });
  const identity = manager.resolveIdentity(a, {}, base);
  const sibling = manager.resolveIdentity(b, {}, base);
  assert.notEqual(identity.sessionId, sibling.sessionId);
  assert.equal(identity.routingKey, sibling.routingKey);
  manager.bindResponse('resp-private', a, identity);
  assert.ok(manager.getResponse('resp-private', a));
  assert.equal(manager.getResponse('resp-private', b), null);
  assert.notEqual(manager.resolveIdentity(request({ 'session-id': 'other-root', 'thread-id': 'child-a' }), {}, base).sessionId,
    identity.sessionId);
  assert.equal(manager.resolveIdentity(request({ 'session-id': 'root', 'thread-id': 'root' }), {}, base).sessionId,
    manager.resolveIdentity(request({ 'session-id': 'root' }), {}, base).sessionId);
  assert.equal(new SessionManager().resolveIdentity(a, {}, base).sessionId, identity.sessionId);
});

test('unknown clients may provide thread metadata and a shared cache cohort without merging their histories', () => {
  const manager = new SessionManager();
  const resolve = thread => manager.resolveIdentity(request({}), { prompt_cache_key: 'cohort', metadata: { thread_id: thread } }, base);
  assert.notEqual(resolve('a').sessionId, resolve('b').sessionId);
  assert.equal(resolve('a').routingKey, resolve('b').routingKey);
});

test('Responses endpoint isolates sibling threads and advertises thread metadata in browser preflight', async t => {
  const { AccountPool } = require('../src/account-pool');
  const { createServer } = require('../antigravity-gateway');
  const seen = [];
  t.mock.method(AccountPool.prototype, 'listModels', async () => [model]);
  t.mock.method(AccountPool.prototype, 'send', async (_normalized, _model, options) => {
    seen.push(options);
    return { text: 'Synthetic result.', toolCalls: [], usage: { input_tokens: 5000, output_tokens: 2, total_tokens: 5002,
      cache_read_tokens: 4000 } };
  });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/v1/responses`;
  const preflight = await fetch(url, { method: 'OPTIONS' });
  assert.ok(preflight.headers.get('access-control-allow-headers').includes('thread-id'));
  for (const thread of ['child-a', 'child-b']) {
    const result = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'session-id': 'root',
      'thread-id': thread }, body: JSON.stringify({ model, input: 'Synthetic input.' }) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).usage.input_tokens_details.cached_tokens, 4000);
  }
  assert.notEqual(seen[0].sessionId, seen[1].sessionId);
  assert.equal(seen[0].routingKey, seen[1].routingKey);
});

for (const [name, tail, expected] of [
  ['omitted counters preserve previous cache and thought counts', { promptTokenCount: 20000, candidatesTokenCount: 2, totalTokenCount: 20009 }, { cache: 16000, thoughts: 7 }],
  ['explicit zeros replace previous counts', { promptTokenCount: 20000, cachedContentTokenCount: 0, thoughtsTokenCount: 0 }, { cache: 0, thoughts: 0 }],
  ['cache-only metadata is accepted', { cachedContentTokenCount: 17000 }, { cache: 17000, thoughts: 7 }],
  ['empty metadata preserves previous counts', {}, { cache: 16000, thoughts: 7 }],
  ['invalid counters do not poison known usage', { cachedContentTokenCount: -1, thoughtsTokenCount: 'invalid' }, { cache: 16000, thoughts: 7 }]
]) test(`stream usage: ${name}`, async () => {
  const frames = [
    { candidates: [{ content: { parts: [{ text: 'A' }] } }], usageMetadata: {
      promptTokenCount: 20000, candidatesTokenCount: 1, totalTokenCount: 20008, cachedContentTokenCount: 16000, thoughtsTokenCount: 7 } },
    { response: { candidates: [{ content: { parts: [{ text: 'B' }] }, finishReason: 'STOP' }], usageMetadata: tail } }
  ];
  let posts = 0;
  const provider = new DirectAntigravityProvider({ localAuth: null, accessToken: 'synthetic', projectId: 'synthetic', maxRetries: 0,
    sessionStore: new AgySessionStore({ directory: '' }), fetchImpl: async () => {
      posts++;
      return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } });
    } });
  const result = await provider.send({ ...base, messages: [user('Synthetic input.')] }, model, { sessionId: 'usage-test' });
  assert.equal(posts, 1);
  assert.equal(result.usage.cache_read_tokens, expected.cache);
  assert.equal(result.usage.thinking_tokens, expected.thoughts);
  assert.equal(result.usage.input_tokens, 20000);
  assert.equal(result.text, 'AB');
});

function wire(state, messages, now, answer) {
  const native = { state, now };
  const body = buildDirectRequest({ ...base, messages }, model, 'synthetic', 'synthetic', '', null, native).request;
  if (answer) completeNativeContext(state, native.context, model, { role: 'model', parts: [{ text: answer }] }, now + 1000);
  return body;
}

test('forked histories keep original wire prefixes across A/B/A and disk restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cache-stability-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = Date.now() - 10000;
  const store = () => new AgySessionStore({ directory, now: () => now });
  const shared = [user('Shared question.'), assistant('Shared answer.')];
  let original;
  await store().transact('account-a', 'shared-cohort', null, async (state, save) => {
    wire(state, [shared[0]], now, shared[1].text);
    original = wire(state, [...shared, user('Task A.')], now + 2000, 'Result A.'.repeat(1000));
    wire(state, [...shared, user('Task B.')], now + 4000, 'Result B.');
    save();
  });
  now += 6000;
  await store().transact('account-a', 'shared-cohort', null, async state => {
    const returned = wire(state, [...shared, user('Task A.'), assistant('Result A.'.repeat(1000)), user('Continue A.')], now);
    assert.deepEqual(returned.contents.slice(0, 3), original.contents);
    assert.deepEqual(returned.systemInstruction, original.systemInstruction);
    assert.deepEqual(returned.tools, original.tools);
    const privateIndex = JSON.stringify(state.timelineAnchors);
    assert.doesNotMatch(privateIndex, /Shared question|Task A|Result A|thoughtSignature/);
    state.timeline = []; // Isolate the exact-prefix index from legacy trim alignment.
    const differentPrefix = wire(state, [shared[0], assistant('Different answer.'), user('Task A.')], now + 2000);
    assert.notDeepEqual(differentPrefix.contents[2], original.contents[2], 'a matching user string alone is not a historical anchor');
  });
  await store().transact('account-b', 'shared-cohort', null, async state => {
    assert.equal(state.timelineAnchors, undefined, 'metadata is account-private, like signed history');
    assert.deepEqual(state.responses, {});
  });
});

test('timeline metadata is bounded by entries and bytes without retaining prompt text', () => {
  const state = newState('synthetic', 'synthetic');
  const records = Array.from({ length: 3000 }, (_, i) => {
    const hash = crypto.createHash('sha256').update(String(i)).digest('hex');
    return { key: hash, entry: { fingerprint: hash, timestamp: '2026-11-17T00:00:00Z', settingTo: 'x'.repeat(900) } };
  });
  rememberTimelineEntries(state, records, Date.now());
  assert.ok(Object.keys(state.timelineAnchors).length <= 2048);
  assert.ok(Buffer.byteLength(JSON.stringify(state.timelineAnchors)) <= 512 * 1024);
  assert.ok(Object.keys(state.timelineAnchors).length > 0);
});

for (const [protocol, normalize] of [['responses', normalizeResponses], ['chat', normalizeChat], ['anthropic', normalizeAnthropic]]) {
  test(`unknown ${protocol} client without session or thread headers keeps branch prefixes`, async t => {
    let now = Date.now() - 10000;
    t.mock.method(Date, 'now', () => now);
    const sent = [], manager = new SessionManager();
    const provider = new DirectAntigravityProvider({ localAuth: null, accessToken: 'synthetic', projectId: 'synthetic', maxRetries: 0,
      sessionStore: new AgySessionStore({ directory: '' }), fetchImpl: async (_url, options) => {
        sent.push(JSON.parse(options.body).request);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Result.' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5000, cachedContentTokenCount: 4000, candidatesTokenCount: 2, totalTokenCount: 5002 } }),
        { headers: { 'content-type': 'application/json' } });
      } });
    const messages = task => [{ role: 'user', content: 'Shared question.' }, { role: 'assistant', content: 'Shared answer.' },
      { role: 'user', content: task }];
    for (const task of ['Task A.', 'Task B.', 'Task A.']) {
      const payload = protocol === 'responses' ? { model, input: messages(task) } : { model, messages: messages(task), max_tokens: 32 };
      const normalized = normalize(payload);
      const identity = manager.resolveIdentity(request({}), payload, normalized);
      assert.equal(identity.reuseConversation, false, 'no invented explicit client identity');
      await provider.send(normalized, model, identity);
      now += 2000;
    }
    assert.deepEqual(sent[2].contents, sent[0].contents);
    assert.notDeepEqual(sent[1].contents, sent[0].contents);
  });
}
