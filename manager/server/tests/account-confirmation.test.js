'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { registerAccountRoutes } = require('../src/routes/accounts');

test('account deletion requires the full email, ID or legacy masked confirmation', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const deleted = [];
  const account = { id: 'demo-account', email: 'alice.full@example.com', emailMasked: 'a***l@example.com' };
  registerAccountRoutes(app, {
    requireAdmin: () => ({ username: 'test-admin' }),
    fail: (reply, status, code, message) => reply.code(status).send({ ok: false, error: { code, message } }),
    gatewayFail: (_, error) => { throw error; },
    gateway: {
      adminGet: async () => ({ items: [account] }),
      adminRequest: async (method, path) => { deleted.push([method, path]); return { deleted: true }; }
    },
    notes: { remove: () => {} },
    auditWrite: () => {}
  });
  for (const confirm of ['', 'alice', 'another@example.com']) {
    const response = await app.inject({ method: 'DELETE', url: '/admin/api/accounts/demo-account', payload: { confirm } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'confirm_mismatch');
  }
  assert.equal(deleted.length, 0);
  for (const confirm of [' alice.full@example.com ', account.id, account.emailMasked]) {
    const response = await app.inject({ method: 'DELETE', url: '/admin/api/accounts/demo-account', payload: { confirm } });
    assert.equal(response.statusCode, 200);
  }
  assert.equal(deleted.length, 3);
});
