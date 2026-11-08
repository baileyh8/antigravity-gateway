'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { AccountPool } = require('../src/account-pool');
const { AccountStore } = require('../src/account-store');
const { ExecutionSlots, WaitBudget } = require('../src/admission-control');
const { affinityTurnLimit, SESSION_TTL_MS } = require('../src/account-scheduling');
const { affinityBinding } = require('../src/session-affinity');
const NOW = Date.parse('2026-11-03T00:00:00Z');
const MODEL = 'gemini-4-argon';
const models = ['gemini-test', 'claude-test', 'gpt-test', MODEL, 'gemini-3.1-flash-image'];
const group = (id, remaining, window = 'weekly', reset = NOW + 86400000) => ({ id, buckets: [
  { window, remainingFraction: remaining, resetTime: new Date(reset).toISOString() }
] });

function fixture(t, channel = 'cloudcode', remaining = .8, count = 2) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-affinity-turns-'));
  const cloud = channel === 'cloudcode';
  const store = cloud ? new AccountStore({ configDir: dir }) : new GeminiAccountStore({ configDir: dir });
  let now = NOW;
  const snapshots = new Map(), calls = [];
  const quota = () => ({ fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1800000).toISOString(),
    groups: cloud ? [group('gemini', remaining), group('3p', remaining), group('gemini-argon', remaining)] : [group('gemini-robin', remaining)] });
  for (const id of ['a', 'b'].slice(0, count)) {
    const snapshot = quota(); snapshots.set(id, snapshot);
    store.save({ id, subjectId: id, email: `${id}@example.com`, accessToken: 'synthetic', projectId: 'test',
      providerType: cloud ? 'cloudcode' : 'robin', accountType: cloud ? 'antigravity' : 'gemini-app',
      authMethod: channel === 'windows' ? 'gemini-windows-session' : 'oauth', capabilities: models,
      providerMetadata: channel === 'windows' ? { geminiWindowsQuota: snapshot,
        geminiWindows: { cookies: [{ name: 'SID', value: 'synthetic', domain: '.google.com' }] } } : { robinQuota: snapshot }
    });
  }
  const state = { calls, snapshots, store, advance: ms => { now += ms; } };
  const factory = record => ({ listModels: async () => models,
    send: async (_input, model, options) => {
      calls.push({ id: record.id, model, options });
      return state.send ? state.send(record.id, model, options) : { text: 'OK', toolCalls: [], usage: {} };
    }, generateImage: async () => ({ data: 'synthetic', usage: {} }) });
  const pools = [];
  const make = () => {
    const created = cloud ? new AccountPool({ store, now: () => now, providerFactory: factory })
      : new RobinAccountPool({ store, now: () => now, providerFactory: factory });
    pools.push(created);
    return created;
  };
  const pool = make();
  if (cloud) pool.quotaManager = { peek: id => snapshots.get(id), get: id => snapshots.get(id),
    getSchedulingSnapshot: id => snapshots.get(id), refreshAccount: async () => null };
  else pool.refreshAccountQuota = () => {};
  pool.admission = new ExecutionSlots({ limit: 10, accountLimit: 5, budget: new WaitBudget({ limit: 120, timeoutMs: 2000 }) });
  const setQuota = (id, snapshot) => {
    snapshots.set(id, snapshot);
    if (!cloud) {
      const account = store.list().find(a => a.id === id);
      store.update(id, { providerMetadata: { ...account.providerMetadata,
        [channel === 'windows' ? 'geminiWindowsQuota' : 'robinQuota']: snapshot } });
    }
  };
  t.after(() => { for (const created of pools) created.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return Object.assign(state, { pool, make, setQuota, turn: (key = 'chat', model = MODEL, extra = {}) =>
    pool.send({ messages: [], tools: [] }, model, { sessionId: key, routingKey: 'family', ...extra }),
    binding: (model = MODEL) => affinityBinding(pool.sessions.get('family'), model, cloud ? 'cloudcode' : 'robin') });
}

test('the inclusive 20% turn limit follows valid windows, native float precision and the requested group', () => {
  for (const remaining of [.2, '0.2', 1 - Math.fround(.8), .1]) {
    const snapshot = { groups: [group('gemini', .8), group('3p', remaining)] };
    assert.equal(affinityTurnLimit(snapshot, NOW, 'gemini-test'), 20);
    assert.equal(affinityTurnLimit(snapshot, NOW, 'gpt-test'), 5);
  }
  assert.equal(affinityTurnLimit({ groups: [group('gemini', .20001)] }, NOW, 'gemini-test'), 20);
  assert.equal(affinityTurnLimit({ groups: [group('gemini', .1, '5h', NOW - 1)] }, NOW, 'gemini-test'), 20);
  const snapshot = { groups: [{ id: 'gemini', buckets: [
    ...group('gemini', .8).buckets, ...group('gemini', .2, '5h').buckets
  ] }] };
  assert.equal(affinityTurnLimit(snapshot, NOW, 'gemini-test'), 5);
  for (const remaining of [null, undefined, '', false, NaN]) {
    assert.equal(affinityTurnLimit({ groups: [group('gemini', remaining)] }, NOW, 'gemini-test'), 20);
  }
});

for (const channel of ['cloudcode']) {
  test(`${channel}: rotate after 20 successes, or five with at most 20% quota, and keep the next binding`, async t => {
    for (const [remaining, limit] of [[.8, 20], [.2, 5]]) {
      const state = fixture(t, channel, remaining);
      for (let i = 0; i < limit; i++) assert.equal((await state.turn()).accountId, 'a');
      assert.equal(state.binding().turns, limit);
      assert.equal((await state.turn()).accountId, 'b');
      assert.equal(state.binding().turns, 1);
      assert.equal((await state.turn()).accountId, 'b');
    }
  });

  test(`${channel}: lower quota immediately shortens an existing binding; the 5% reserve still blocks it`, async t => {
    const state = fixture(t, channel);
    for (let i = 0; i < 8; i++) await state.turn();
    const snapshot = structuredClone(state.snapshots.get('a'));
    for (const g of snapshot.groups) g.buckets[0].remainingFraction = .2;
    state.setQuota('a', snapshot);
    assert.equal((await state.turn()).accountId, 'b');
    for (const id of ['a', 'b']) {
      const low = structuredClone(state.snapshots.get(id));
      for (const g of low.groups) g.buckets[0].remainingFraction = .05;
      state.setQuota(id, low);
    }
    const before = state.calls.length;
    await assert.rejects(state.turn(), { code: 'quota_reserve_reached' });
    assert.equal(state.calls.length, before);
  });

  test(`${channel}: failed or cancelled attempts do not add turns; counters survive a graceful restart`, async t => {
    const state = fixture(t, channel, .2);
    for (let i = 0; i < 4; i++) await state.turn();
    state.send = async () => { throw Object.assign(new Error('invalid request'), { status: 400 }); };
    await assert.rejects(state.turn(), /invalid request/);
    assert.equal(state.binding().turns, 4);
    state.send = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };
    await assert.rejects(state.turn(), /cancelled/);
    assert.equal(state.binding().pending, 0);
    assert.equal(state.binding().turns, 4);
    delete state.send;
    await state.turn();
    state.pool.stop();
    const restored = state.make();
    if (channel === 'cloudcode') restored.quotaManager = state.pool.quotaManager;
    else restored.refreshAccountQuota = () => {};
    assert.equal(affinityBinding(restored.sessions.get('family'), MODEL, channel === 'cloudcode' ? 'cloudcode' : 'robin').turns, 5);
    assert.equal(restored.selectAccount(MODEL, 'family', new Set()).account.id, 'b');
    assert.equal(fs.readFileSync(state.pool.stateFile, 'utf8').includes('pending'), false);
  });

  test(`${channel}: expiry prefers a different account; a single eligible account remains usable above reserve`, async t => {
    const state = fixture(t, channel);
    await state.turn();
    state.advance(SESSION_TTL_MS + 1);
    assert.equal((await state.turn()).accountId, 'b');
    const single = fixture(t, channel, .2, 1);
    for (let i = 0; i < 7; i++) assert.equal((await single.turn()).accountId, 'a');
  });
}

test('Gemini, Claude/GPT and Argon keep independent bindings and counts; images cannot bypass the Gemini turn budget', async t => {
  const state = fixture(t, 'cloudcode', .2);
  for (let i = 0; i < 5; i++) await state.turn('chat', 'gemini-test');
  await state.turn('chat', 'claude-test');
  assert.equal(state.binding('claude-test').turns, 1);
  const image = await state.pool.generateImage({ prompt: 'synthetic' }, { routingKey: 'family', accountId: 'a' });
  assert.equal(image.accountId, 'b');
  assert.equal(state.binding('gemini-test').turns, 1);
  assert.equal((await state.turn('chat', 'gpt-test')).accountId, 'a');
  assert.equal(state.binding('claude-test').turns, 2);
  assert.equal((await state.turn()).accountId, 'a');
  assert.equal(state.binding().turns, 1);
});

test('parallel requests reserve turn budget before dispatch and late successes cannot move a newer binding back', async t => {
  const state = fixture(t, 'cloudcode', .2);
  for (let i = 0; i < 4; i++) await state.turn();
  const pending = [];
  state.send = id => new Promise(resolve => pending.push({ id, resolve }));
  const turns = [state.turn('parent'), state.turn('child')];
  for (let i = 0; i < 100 && pending.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(pending.map(x => x.id), ['a', 'b']);
  pending[1].resolve({ text: 'OK', toolCalls: [], usage: {} });
  await turns[1];
  pending[0].resolve({ text: 'OK', toolCalls: [], usage: {} });
  await turns[0];
  assert.equal(state.binding().accountId, 'b');
  assert.equal(state.binding().turns, 1);
});

test('auxiliary image calls consume the existing owner budget without migrating the parent on fallback', async t => {
  const state = fixture(t, 'cloudcode', .2);
  await state.turn('chat', 'gemini-test');
  for (let i = 0; i < 4; i++) {
    assert.equal((await state.pool.generateImage({}, { routingKey: 'family', accountId: 'a', bindRouting: false })).accountId, 'a');
  }
  assert.equal(state.binding('gemini-test').turns, 5);
  assert.equal((await state.pool.generateImage({}, { routingKey: 'family', accountId: 'a', bindRouting: false })).accountId, 'b');
  assert.equal(state.binding('gemini-test').accountId, 'a');
  assert.equal(state.binding('gemini-test').turns, 5);
  assert.equal((await state.turn('chat', 'gemini-test')).accountId, 'b');
});

test('queued work rechecks the latest successful count when its execution slot becomes available', async t => {
  const state = fixture(t, 'cloudcode', .2);
  for (let i = 0; i < 4; i++) await state.turn();
  state.pool.admission = new ExecutionSlots({ limit: 1, accountLimit: 5, budget: new WaitBudget({ timeoutMs: 2000 }) });
  const pending = [];
  state.send = id => new Promise(resolve => pending.push({ id, resolve }));
  const turns = [state.turn('parent'), state.turn('child')];
  for (let i = 0; i < 100 && !state.pool.admission.waiters.length; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending[0].id, 'a');
  assert.equal(state.pool.admission.waiters.length, 1);
  pending[0].resolve({ text: 'OK', toolCalls: [], usage: {} });
  await turns[0];
  assert.equal(pending[1].id, 'b');
  pending[1].resolve({ text: 'OK', toolCalls: [], usage: {} });
  await turns[1];
});

