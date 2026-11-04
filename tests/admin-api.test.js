'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { dailyTrend, handleAdminRequest, maskEmail, overview } = require('../src/admin-api');
const { AccountPool } = require('../src/account-pool');
const { AccountStore } = require('../src/account-store');

function deps() {
  const now = Date.now();
  const history = [];
  for (let index = 0; index < 48; index += 1) {
    history.push({
      at: new Date(now - index * 3600 * 1000).toISOString(),
      clientRequests: 2,
      upstreamCalls: 2,
      successfulUpstreamCalls: 2,
      failedUpstreamCalls: index % 8 === 0 ? 1 : 0,
      inputTokens: 100,
      outputTokens: 50,
      thinkingTokens: 0,
      cachedTokens: 10,
      totalTokens: 150
    });
  }
  return {
    token: 'a'.repeat(32),
    version: 'test-version',
    startedAt: new Date(now - 7200 * 1000).toISOString(),
    transport: 'direct',
    defaultModel: 'gemini-test',
    usageStore: { summary: () => ({ lifetime: { clientRequests: 4, totalTokens: 600 }, history }) },
    accountPool: {
      status: () => [
        { id: 'a1', email: 'bailey@example.com', state: 'available', weight: 1 },
        { id: 'a2', email: 'backup@example.com', state: 'cooldown', weight: 2 }
      ]
    },
    robinAccountPool: { status: () => [] },
    quotaManager: { peek: () => null, get: () => null },
    concurrency: () => ({ requests: { active: 1, queued: 0, limit: 8 }, memory: {} })
  };
}

test('admin api masks emails without collapsing distinct accounts', () => {
  assert.equal(maskEmail('bailey@example.com'), 'b***y@example.com');
  assert.equal(maskEmail('backup@example.com'), 'b***p@example.com');
  assert.equal(maskEmail('a@example.com'), 'a***@example.com');
});

test('admin api trend fills every day and keeps counters', () => {
  const now = Date.parse('2026-11-01T10:00:00+08:00');
  const trend = dailyTrend([
    { at: '2026-11-01T01:00:00.000Z', clientRequests: 3, totalTokens: 30, failedUpstreamCalls: 1 },
    { at: '2026-10-31T01:00:00.000Z', clientRequests: 2, totalTokens: 20, failedUpstreamCalls: 0 }
  ], 3, now);
  assert.equal(trend.length, 3);
  assert.equal(trend[2].date, '2026-11-01');
  assert.equal(trend[2].requests, 3);
  assert.equal(trend[2].tokens, 30);
  assert.equal(trend[2].failures, 1);
});

test('admin api overview reports account counts and today totals', () => {
  const data = overview(deps());
  assert.equal(data.accounts.total, 2);
  assert.equal(data.accounts.available, 1);
  assert.equal(data.accounts.cooldown, 1);
  assert.equal(data.accounts.items[0].emailMasked, 'b***y@example.com');
  assert.equal('email' in data.accounts.items[0], false);
  assert.equal(data.usage.today.totalTokens > 0, true);
  assert.equal(data.trend.length, 14);
  assert.deepEqual(data.affinityPolicy, { maxTurns: 20, lowQuotaMaxTurns: 5, lowQuotaPercent: 20, ttlSeconds: 18000 });
  assert.deepEqual(data.quotaPolicy.reservePercentByWindow, { '5h': 10, weekly: 5 });
  assert.equal(data.quotaPolicy.selection,'remaining_headroom');
});

test('admin api rejects missing and wrong tokens before reading state', async () => {
  const responses = [];
  function res() {
    return {
      writeHead: (status, headers) => responses.push({ status, headers }),
      end: () => {}
    };
  }
  await handleAdminRequest({
    req: { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: {} },
    res: res(),
    route: '/_admin/v1/overview',
    deps: { ...deps(), token: '' }
  });
  await handleAdminRequest({
    req: { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-agy-admin-token': 'wrong' } },
    res: res(),
    route: '/_admin/v1/overview',
    deps: deps()
  });
  assert.equal(responses[0].status, 404);
  assert.equal(responses[1].status, 401);
});

function fakeRequest(method, body, { token = 'a'.repeat(32), remote = '127.0.0.1', query = '' } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    socket: { remoteAddress: remote },
    headers: token ? { 'x-agy-admin-token': token } : {},
    [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk; }
  };
}

function capture() {
  const result = { status: 0, body: null };
  return {
    result,
    res: {
      writeHead: (status) => { result.status = status; },
      end: (payload) => { result.body = payload ? JSON.parse(payload) : null; }
    }
  };
}

test('admin api account writes dispatch to the selected pool', async () => {
  const calls = [];
  const pool = {
    status: () => [{ id: 'acc-1', state: 'available' }],
    updateAccount: (id, patch) => { calls.push(['update', id, patch]); return { account: { id, weight: patch.weight } }; },
    recheckAccount: async (id) => { calls.push(['recheck', id]); return { account: { id, state: 'available' }, unchanged: true }; },
    removeAccount: (id) => { calls.push(['remove', id]); return { id, deleted: true }; }
  };
  const base = deps();
  const writeDeps = { ...base, accountPool: pool };
  const { res, result } = capture();
  await handleAdminRequest({
    req: fakeRequest('PATCH', { weight: 3 }),
    res,
    route: '/_admin/v1/accounts/acc-1',
    requestUrl: new URL('http://localhost/_admin/v1/accounts/acc-1'),
    deps: writeDeps
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0], ['update', 'acc-1', { enabled: undefined, weight: 3 }]);

  const recheck = capture();
  await handleAdminRequest({
    req: fakeRequest('POST', undefined),
    res: recheck.res,
    route: '/_admin/v1/accounts/acc-1/recheck',
    requestUrl: new URL('http://localhost/_admin/v1/accounts/acc-1/recheck'),
    deps: writeDeps
  });
  assert.equal(recheck.result.status, 200);
  assert.deepEqual(calls[1], ['recheck', 'acc-1']);

  const remove = capture();
  await handleAdminRequest({
    req: fakeRequest('DELETE', undefined),
    res: remove.res,
    route: '/_admin/v1/accounts/acc-1',
    requestUrl: new URL('http://localhost/_admin/v1/accounts/acc-1'),
    deps: writeDeps
  });
  assert.equal(remove.result.status, 200);
  assert.deepEqual(calls[2], ['remove', 'acc-1']);
});

test('admin api proxy writes dispatch to the proxy manager', async () => {
  const calls = [];
  const proxyManager = {
    state: { proxies: [] },
    snapshot: () => ({ proxies: [], bindings: {} }),
    upsert: (body) => { calls.push(['upsert', body]); return { proxies: [{ id: 'p1' }], bindings: {} }; },
    check: async (id) => { calls.push(['check', id]); return { ok: true }; },
    remove: (id) => { calls.push(['remove', id]); return { proxies: [], bindings: {} }; },
    bind: (id, proxyId) => { calls.push(['bind', id, proxyId]); return { proxies: [], bindings: {} }; }
  };
  const writeDeps = { ...deps(), proxyManager };
  const created = capture();
  await handleAdminRequest({
    req: fakeRequest('POST', { name: 'test', url: 'http://127.0.0.1:1' }),
    res: created.res,
    route: '/_admin/v1/proxies',
    requestUrl: new URL('http://localhost/_admin/v1/proxies'),
    deps: writeDeps
  });
  assert.equal(created.result.status, 200);
  assert.equal(calls[0][0], 'upsert');

  const checked = capture();
  await handleAdminRequest({
    req: fakeRequest('POST', undefined),
    res: checked.res,
    route: '/_admin/v1/proxies/p1/check',
    requestUrl: new URL('http://localhost/_admin/v1/proxies/p1/check'),
    deps: writeDeps
  });
  assert.equal(checked.result.status, 200);
  assert.deepEqual(calls[1], ['check', 'p1']);
});

test('account pool persists weight and enabled changes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-account-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new AccountStore({ configDir: directory });
  const saved = store.save({ email: 'update@example.com', accessToken: 'token', refreshToken: 'refresh', weight: 1 });
  const pool = new AccountPool({
    store,
    providerFactory: () => ({}),
    stateFile: path.join(directory, 'state', 'account-pool.json')
  });
  const updated = pool.updateAccount(saved.id, { weight: 3, enabled: false });
  assert.equal(updated.account.weight, 3);
  assert.equal(updated.account.state, 'disabled');
  const persisted = store.list().find((account) => account.id === saved.id);
  assert.equal(persisted.weight, 3);
  assert.equal(persisted.enabled, false);
  pool.updateAccount(saved.id, { weight: 1, enabled: true });
});
