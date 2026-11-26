'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountStore } = require('../src/account-store');

test('credential renewal preserves checked plan, health metadata and manual pause', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-status-metadata-'));
  try {
    const store = new AccountStore({ configDir: directory });
    const saved = store.save({ email: 'status@example.com', accessToken: 'synthetic-initial-access', refreshToken: 'synthetic-refresh', enabled: false, weight: 2,
      healthCheckedAt: '2030-01-01T00:00:00Z', healthCheckStatus: 'rate_limited', planName: 'free-tier', lastSuccessAt: '2029-12-31T23:00:00Z' });
    const renewed = store.updateCredentials(saved, { accessToken: 'synthetic-renewed-access' });
    assert.equal(renewed.enabled, false);
    assert.equal(renewed.weight, 2);
    assert.equal(renewed.healthCheckedAt, saved.healthCheckedAt);
    assert.equal(renewed.healthCheckStatus, 'rate_limited');
    assert.equal(renewed.planName, 'free-tier');
    assert.equal(renewed.lastSuccessAt, saved.lastSuccessAt);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
