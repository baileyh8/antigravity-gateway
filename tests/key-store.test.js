'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { KeyStore } = require('../src/key-store');
const keyContext = require('../src/key-context');

function request(secret, { ip = '1.2.3.4', forwarded = '' } = {}) {
  return {
    headers: { authorization: `Bearer ${secret}`, ...(forwarded ? { 'x-forwarded-for': forwarded } : {}) },
    socket: { remoteAddress: ip }
  };
}

test('key store creates, authenticates and attributes usage', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-keys-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const previous = process.env.ANTIGRAVITY_GATEWAY_API_KEY;
  delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
  t.after(() => { if (previous !== undefined) process.env.ANTIGRAVITY_GATEWAY_API_KEY = previous; });
  const store = new KeyStore({ configDir: directory, pepper: 'pepper', multiKey: true });
  const created = store.create({ name: 'test', quota: { tokens: 1000, requests: 10 }, ratePerMin: 2 });
  assert.match(created.secret, /^agy_sk_[a-f0-9]{8}_/);
  assert.equal(store.list()[0].hash, undefined);
  const auth = store.authenticate(request(created.secret));
  assert.equal(auth.error, undefined);
  assert.equal(auth.context.id, created.key.id);
  keyContext.run(auth.context, () => {
    store.recordRequest();
    store.recordUsage({ usage: { total_tokens: 40 }, model: 'gemini-test' });
  });
  const listed = store.list()[0];
  assert.equal(listed.usage.requests, 1);
  assert.equal(listed.usage.tokens, 40);
  assert.equal(listed.usage.byModel['gemini-test'], 40);
  assert.equal(store.authenticate(request('agy_sk_00000000_bad')).error.code, 'invalid_api_key');
  store.stop();
});

test('key store enforces disabled, quota, ip and rate limits', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-keys-limit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new KeyStore({ configDir: directory, pepper: 'pepper', multiKey: true });
  const created = store.create({ name: 'limited', ipAllowlist: ['10.0.0.0/8'], quota: { requests: 1 }, ratePerMin: 1 });
  assert.equal(store.authenticate(request(created.secret, { ip: '1.2.3.4' })).error.code, 'ip_not_allowed');
  const auth = store.authenticate(request(created.secret, { ip: '10.1.2.3' }));
  assert.equal(auth.error, undefined);
  keyContext.run(auth.context, () => store.recordRequest());
  assert.equal(store.authenticate(request(created.secret, { ip: '10.1.2.3' })).error.code, 'key_quota_exceeded');
  store.update(created.key.id, { quota: { requests: 0 }, enabled: false });
  assert.equal(store.authenticate(request(created.secret, { ip: '10.1.2.3' })).error.code, 'key_disabled');
  store.stop();
});
