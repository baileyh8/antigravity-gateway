'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { LoginLimiter, burnPasswordCheckAsync, hashPasswordAsync, verifyPasswordAsync } = require('../src/auth');

test('async password helpers hash and verify without breaking format compatibility', async () => {
  const hash = await hashPasswordAsync('Strong-Pass-2026!');
  assert.match(hash, /^pbkdf2_sha256\$260000\$/);
  assert.equal(await verifyPasswordAsync('Strong-Pass-2026!', hash), true);
  assert.equal(await verifyPasswordAsync('Wrong-Pass-2026!', hash), false);
  await burnPasswordCheckAsync('Any-Pass');
});

test('LoginLimiter prunes expired entries and enforces maxEntries bound', () => {
  let now = 1_000_000;
  const limiter = new LoginLimiter({
    maxFailures: 3,
    lockMs: 60_000,
    entryTtlMs: 120_000,
    maxEntries: 4,
    now: () => now
  });

  limiter.fail('ip1|alice');
  limiter.fail('ip2|bob');
  limiter.fail('ip3|charlie');
  limiter.fail('ip4|dave');
  assert.equal(limiter.entries.size, 4);

  // Adding a 5th entry evicts the oldest so memory stays bounded.
  limiter.fail('ip5|eve');
  assert.equal(limiter.entries.size, 4);
  assert.equal(limiter.entries.has('ip1|alice'), false);

  // Sub-threshold failure entries expire after entryTtlMs on prune().
  now += 130_000;
  limiter.prune();
  assert.equal(limiter.entries.size, 0);

  // Locked entry clears after lockMs.
  limiter.fail('ip6|frank');
  limiter.fail('ip6|frank');
  limiter.fail('ip6|frank');
  assert.ok(limiter.retryAfter('ip6|frank') > 0);
  now += 61_000;
  limiter.prune();
  assert.equal(limiter.entries.size, 0);
});

test('manager store caches users safely and serializes audit writes with pruneAudit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-manager-store-'));
  const previousDir = process.env.AGY_MANAGER_DATA_DIR;
  const previousSecret = process.env.AGY_SESSION_SECRET;
  process.env.AGY_MANAGER_DATA_DIR = directory;
  process.env.AGY_SESSION_SECRET = 'synthetic-store-secret-'.repeat(3);

  try {
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/store')];
    const store = require('../src/store');

    store.bootstrapAdmin();
    const first = store.getUser('bailey');
    assert.ok(first);
    const updated = store.updateUser('bailey', { sessionEpoch: 2 });
    assert.equal(updated.sessionEpoch, 2);
    assert.equal(store.getUser('bailey').sessionEpoch, 2);

    // Concurrent audit writes and pruneAudit must serialize without losing rows.
    const ops = [];
    for (let i = 0; i < 10; i += 1) {
      ops.push(store.audit({ actor: 'bailey', ip: '127.0.0.1', action: `test.${i}`, target: String(i) }));
    }
    ops.push(store.pruneAudit());
    for (let i = 10; i < 15; i += 1) {
      ops.push(store.audit({ actor: 'bailey', ip: '127.0.0.1', action: `test.${i}`, target: String(i) }));
    }
    await Promise.all(ops);
    await store.flushAudit();

    const page = store.readAudit({ days: 7, page: 1, size: 50 });
    assert.equal(page.total, 15);
  } finally {
    if (previousDir === undefined) delete process.env.AGY_MANAGER_DATA_DIR;
    else process.env.AGY_MANAGER_DATA_DIR = previousDir;
    if (previousSecret === undefined) delete process.env.AGY_SESSION_SECRET;
    else process.env.AGY_SESSION_SECRET = previousSecret;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
