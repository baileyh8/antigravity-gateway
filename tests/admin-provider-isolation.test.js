'use strict';
process.env.AGY_ADMIN_TOKEN = 'synthetic-admin-isolation';
const assert = require('node:assert/strict');
const test = require('node:test');
delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
const { AccountPool } = require('../src/account-pool');
const { createServer } = require('../antigravity-gateway');

async function fixture(t, { cloudcode = ['same-id'] } = {}) {
  const operations = [];
  t.mock.method(AccountPool.prototype, 'status', () => cloudcode.map(id => ({ id })));
  for (const [method, action] of [['removeAccount', 'delete'], ['recheckAccount', 'recheck']]) {
    t.mock.method(AccountPool.prototype, method, id => {
      operations.push({ provider: 'cloudcode', action, id });
      return { id, providerType: 'cloudcode', action };
    });
  }
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const request = async (action, query = '', id = 'same-id') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/_admin/v1/accounts/${id}${action === 'recheck' ? '/recheck' : ''}${query}`, {
      method: action === 'recheck' ? 'POST' : 'DELETE', headers: {'x-agy-admin-token':process.env.AGY_ADMIN_TOKEN}
    });
    return { status: response.status, body: await response.json() };
  };
  return { operations, request };
}

test('admin API account mutations reject invalid, empty and repeated provider parameters before touching the pool', async t => {
  const { operations, request } = await fixture(t);
  for (const action of ['recheck', 'delete']) {
    for (const query of ['?provider=robni', '?provider=', '?provider=robin&provider=cloudcode', '?provider=cloudcode&provider=cloudcode']) {
      const response = await request(action, query);
      assert.equal(response.status, 400, `${action} ${query}`);
      assert.equal(response.body.error.code, 'invalid_account_provider');
    }
  }
  assert.deepEqual(operations, []);
});

test('an explicit cloudcode provider targets its own account', async t => {
  const { operations, request } = await fixture(t);
  for (const action of ['recheck', 'delete']) {
    const response = await request(action, '?provider=cloudcode');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.providerType, 'cloudcode');
  }
  assert.deepEqual(operations, ['cloudcode'].flatMap(provider => ['recheck', 'delete'].map(action => ({ provider, action, id: 'same-id' }))));
});

