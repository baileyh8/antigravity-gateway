'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { AccountStore } = require('../src/account-store');
const { AccountPool } = require('../src/account-pool');
const { RobinAccountPool } = require('../src/robin-account-pool');
const { ExecutionSlots } = require('../src/admission-control');
const { quotaReserveReached, quotaRefreshInterval, quotaRank, weightedPickWithRanks } = require('../src/account-scheduling');
const NOW = Date.parse('2026-11-03T00:00:00Z');
const group = (id, remaining, window = 'weekly', reset = NOW + 3600000) => ({ id,
  buckets: [{ window, remainingFraction: remaining, resetTime: new Date(reset).toISOString() }] });

function cloud(t, remaining = .5) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-reserve-'));
  const store = new AccountStore({ configDir: directory });
  const accounts = ['a', 'b'].map(id => store.save({ id, email: `${id}@example.com`, accessToken: 'synthetic' }));
  let calls = 0;
  const pool = new AccountPool({ store, now: () => NOW, providerFactory: () => ({
    listModels: async () => ['gemini-test', 'claude-test', 'gemini-4-argon-low'],
    send: async () => { calls++; return { text: 'OK', toolCalls: [], usage: {} }; }
  }) });
  const snapshots = new Map(accounts.map(a => [a.id, { groups: [group('gemini', remaining), group('3p', .8), group('gemini-argon', .8)] }]));
  pool.quotaManager = { peek: id => snapshots.get(id), get: id => snapshots.get(id),
    getSchedulingSnapshot: id => snapshots.get(id), refreshAccount: async () => null };
  pool.admission = new ExecutionSlots({ limit: 10, accountLimit: 5 });
  t.after(() => { pool.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { pool, accounts, snapshots, calls: () => calls };
}

test('the inclusive 5% reserve follows only the requested group and its unexpired windows', () => {
  for (const remaining of [0, .01, .05, '0.05', 1 - .95, 1 - Math.fround(.95)]) {
    const snapshot = { groups: [group('gemini', remaining), group('3p', .8), group('gemini-argon', .8)] };
    assert.equal(quotaReserveReached(snapshot, NOW, 'gemini-test', 'cloudcode'), true);
    assert.equal(quotaReserveReached(snapshot, NOW, 'claude-test', 'cloudcode'), false);
    assert.equal(quotaReserveReached(snapshot, NOW, 'gemini-4-argon-low', 'cloudcode'), false);
  }
  assert.equal(quotaReserveReached({ groups: [group('gemini', .05001)] }, NOW, 'gemini-test'), false);
  for (const remaining of [null, undefined, '', false, NaN]) {
    assert.equal(quotaReserveReached({ groups: [group('gemini', remaining)] }, NOW, 'gemini-test'), false);
  }
  const snapshot = { groups: [{ id: 'gemini', buckets: [
    ...group('gemini', .05, '5h', NOW - 1).buckets, ...group('gemini', .05).buckets
  ] }] };
  assert.equal(quotaReserveReached(snapshot, NOW, 'gemini-test'), true, '5h reset does not release weekly reserve');
  snapshot.groups[0].buckets[1].remainingFraction = .8;
  assert.equal(quotaReserveReached(snapshot, NOW, 'gemini-test'), false);
});

test('weighted fallback cannot select accounts at the reserve even when every account is held', () => {
  const ranks = ['a', 'b'].map(id => quotaRank({ account: { id, weight: 1 } },
    { groups: [group('gemini', .05)] }, NOW, false, 'gemini-test', 'cloudcode'));
  assert.equal(weightedPickWithRanks(ranks, new Map()), null);
});

test('only the selected group controls one-minute versus 15-second summary polling', () => {
  const snapshot = { groups: [group('gemini', .2), group('3p', .8)] };
  assert.equal(quotaRefreshInterval(snapshot, NOW, 'gemini-test', 'cloudcode'), 15000);
  assert.equal(quotaRefreshInterval(snapshot, NOW, 'claude-test', 'cloudcode'), 60000);
});

test('Cloud Code affinity switches at the reserve while unrelated model groups remain usable', async t => {
  const { pool, accounts, snapshots } = cloud(t);
  pool.bindSession('family', accounts[0].id);
  snapshots.get(accounts[0].id).groups[0].buckets[0].remainingFraction = .05;
  assert.equal((await pool.send({}, 'claude-test', { routingKey: 'family' })).accountId, accounts[0].id);
  assert.equal((await pool.send({}, 'gemini-test', { routingKey: 'family' })).accountId, accounts[1].id);
  assert.equal(pool.entries.get(accounts[0].id).healthState, 'available');
  assert.equal(pool.entries.get(accounts[0].id).modelCooldowns.size, 0);
});

test('an entirely protected Cloud Code group rejects without dispatch and resumes on a higher reading', async t => {
  const { pool, accounts, snapshots, calls } = cloud(t, .05);
  await assert.rejects(pool.send({}, 'gemini-test'), { code: 'quota_reserve_reached', status: 429 });
  assert.equal(calls(), 0);
  snapshots.get(accounts[0].id).groups[0].buckets[0].remainingFraction = .06;
  assert.equal((await pool.send({}, 'gemini-test')).accountId, accounts[0].id);
  assert.equal(calls(), 1);
});

test('an expired cache cannot erase a known reserve before that bucket resets', t => {
  const { pool, snapshots } = cloud(t, .05);
  pool.quotaManager.getSchedulingSnapshot = () => null;
  pool.quotaManager.get = () => null;
  for (const snapshot of snapshots.values()) snapshot.expiresAt = new Date(NOW - 1).toISOString();
  assert.equal(pool.selectAccount('gemini-test', '', new Set()), null);
});

test('local fallback and image affinity cannot bypass a known reserve', async t => {
  const { pool, accounts, snapshots } = cloud(t, .05);
  for (const snapshot of snapshots.values()) snapshot.groups[0].buckets[0].remainingFraction = .05;
  pool.entries.get(accounts[0].id).provider.generateImage = async () => assert.fail('reserved image account dispatched');
  await assert.rejects(pool.generateImage({}, { accountId: accounts[0].id }), { code: 'quota_reserve_reached' });
  pool.hasManagedAccounts = () => false;
  pool.canUseFallback = () => true;
  pool.quotaManager.peek = () => ({ groups: [group('gemini', .05)] });
  pool.fallbackProvider = { send: async () => assert.fail('local fallback dispatched'),
    generateImage: async () => assert.fail('local image fallback dispatched') };
  await assert.rejects(pool.send({}, 'gemini-test'), { code: 'quota_reserve_reached' });
  await assert.rejects(pool.generateImage({}), { code: 'quota_reserve_reached' });
});

test('queued dispatch rechecks the reserve before consuming an account slot', async t => {
  const { pool, snapshots, calls } = cloud(t);
  pool.admission = new ExecutionSlots({ limit: 1, accountLimit: 1 });
  const release = await pool.admission.acquire();
  const pending = pool.send({}, 'gemini-test');
  const rejected = assert.rejects(pending, { code: 'quota_reserve_reached', status: 429 });
  await new Promise(resolve => setImmediate(resolve));
  for (const snapshot of snapshots.values()) snapshot.groups[0].buckets[0].remainingFraction = .05;
  release();
  await rejected;
  assert.equal(calls(), 0);
  assert.equal(pool.admission.active, 0);
  assert.equal(pool.admission.waiters.length, 0);
});

test('queued local fallback also checks the reserve again after admission', async t => {
  const { pool } = cloud(t);
  pool.hasManagedAccounts = () => false;
  pool.canUseFallback = () => true;
  pool.fallbackProvider = { send: async () => assert.fail('queued local fallback bypassed the reserve') };
  const snapshot = { groups: [group('gemini', .8)] };
  pool.quotaManager.peek = () => snapshot;
  pool.admission = new ExecutionSlots({ limit: 1, accountLimit: 1 });
  const release = await pool.admission.acquire();
  const rejected = assert.rejects(pool.send({}, 'gemini-test'), { code: 'quota_reserve_reached', status: 429 });
  await new Promise(resolve => setImmediate(resolve));
  snapshot.groups[0].buckets[0].remainingFraction = .05;
  release();
  await rejected;
  assert.equal(pool.admission.active, 0);
});

for (const windows of [false, true]) {
  test(`${windows ? 'Windows' : 'Robin OAuth'} respects reserve affinity and retains held task ownership`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-robin-reserve-'));
    const store = new AccountStore({ configDir: directory, directoryName: 'robin-accounts' });
    const quotaKey = windows ? 'geminiWindowsQuota' : 'robinQuota';
    const accounts = ['a', 'b'].map(id => store.save({ id, subjectId: id, accessToken: 'synthetic',
      providerType: 'robin', accountType: 'gemini-app', ...(windows ? { authMethod: 'gemini-windows-session' } : {}),
      capabilities: ['gemini-4-argon'], providerMetadata: { [quotaKey]: { fetchedAt: new Date(NOW).toISOString(),
        groups: [group('gemini-robin', id === 'a' ? .05 : .8)] } } }));
    let calls = 0;
    const pool = new RobinAccountPool({ store, now: () => NOW, providerFactory: () => ({
      send: async () => { calls++; return { text: 'OK', toolCalls: [], usage: {} }; }
    }) });
    t.after(() => { pool.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
    pool.sessions.set('sticky', { accountId: accounts[0].id, at: NOW });
    assert.equal(pool.selectAccount('gemini-4-argon', 'sticky').account.id, accounts[1].id);
    const requestKey = JSON.stringify(['client', 'task']);
    pool.activeTasks.set(requestKey, accounts[0].id);
    await assert.rejects(pool.send({}, 'gemini-4-argon', { clientId: 'client', sessionId: 'task' }),
      { code: 'quota_reserve_reached', status: 429 });
    assert.equal(pool.activeTasks.get(requestKey), accounts[0].id);
    assert.equal(calls, 0);
  });
}
