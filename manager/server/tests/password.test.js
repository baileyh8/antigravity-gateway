'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-manager-auth-'));
process.env.AGY_MANAGER_DATA_DIR = directory;
process.env.AGY_SESSION_SECRET = 'synthetic-test-secret-'.repeat(3);
process.env.AGY_MANAGER_COOKIE_SECURE = '0';
const { app } = require('../src/index');
const store = require('../src/store');

test('password change verifies current secret, revokes old sessions and removes bootstrap file', async () => {
  try {
    store.bootstrapAdmin();
    const password = fs.readFileSync(path.join(directory, 'initial-admin-password'), 'utf8').trim();
    const challenge = await app.inject({ url: '/admin/api/auth/csrf' });
    const csrfCookie = challenge.headers['set-cookie'].split(';')[0];
    const csrfToken = challenge.json().data.token;
    assert.equal((await app.inject({ method: 'POST', url: '/admin/api/auth/login', headers: {origin:'http://127.0.0.1:9898'}, payload: {username:'bailey',password} })).statusCode, 403);
    const login = await app.inject({ method: 'POST', url: '/admin/api/auth/login', headers: { origin: 'http://127.0.0.1:9898', cookie: csrfCookie, 'x-agy-csrf': csrfToken }, payload: { username: 'bailey', password } });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers['set-cookie'].split(';')[0];
    const change = payload => app.inject({ method: 'POST', url: '/admin/api/auth/password', headers: { origin: 'http://127.0.0.1:9898', cookie: cookie + '; ' + csrfCookie, 'x-agy-csrf': csrfToken }, payload });
    assert.equal((await change({ currentPassword: 'wrong', newPassword: 'New-Password-1234' })).statusCode, 400);
    assert.equal((await change({ currentPassword: password, newPassword: 'short' })).statusCode, 400);
    const changed = await change({ currentPassword: password, newPassword: 'New-Password-1234' });
    assert.equal(changed.statusCode, 200);
    const gateway = require('../src/gateway');
    const previous = gateway.getUsage;
    gateway.getUsage = async () => ({ totals: { totalTokens: 42 }, items: [] });
    try {
      const read = await app.inject({ url: '/admin/api/usage', headers: { cookie: changed.headers['set-cookie'].split(';')[0] } });
      assert.equal(read.statusCode, 200); assert.ok(read.headers.etag);
      const unchanged = await app.inject({ url: '/admin/api/usage', headers: { cookie: changed.headers['set-cookie'].split(';')[0], 'if-none-match': read.headers.etag } });
      assert.equal(unchanged.statusCode, 304); assert.equal(unchanged.body, '');
      const anonymous = await app.inject({ url: '/admin/api/usage', headers: { 'if-none-match': read.headers.etag } });
      assert.equal(anonymous.statusCode, 401);
    } finally { gateway.getUsage = previous; }

    assert.equal(fs.existsSync(path.join(directory, 'initial-admin-password')), false);
    assert.equal((await app.inject({ url: '/admin/api/auth/me', headers: { cookie } })).statusCode, 401);
    const freshCookie = changed.headers['set-cookie'].split(';')[0];
    assert.equal((await app.inject({ url: '/admin/api/auth/me', headers: { cookie: freshCookie } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/admin/api/usage?days=32', headers: { cookie: freshCookie } })).statusCode, 400);
  } finally { await app.close(); await new Promise(r => setTimeout(r, 100)); fs.rmSync(directory, { recursive: true, force: true }); }
});
