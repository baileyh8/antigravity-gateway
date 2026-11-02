'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RequestLog } = require('../src/request-log');

test('request log writes, filters and clears by time', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-request-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Date.parse('2026-11-01T10:00:00+08:00');
  const log = new RequestLog({ configDir: directory, now: () => now });
  log.record({ at: now, requestId: 'r1', keyId: 'k1', keyName: 'prod', model: 'm1', status: 200, latencyMs: 12, usage: { total_tokens: 10 } });
  log.record({ at: now - 1000, requestId: 'r2', keyId: 'k2', keyName: 'test', model: 'm2', status: 500, latencyMs: 20 });
  await log.flush();
  assert.equal(log.query({ days: 1 }).total, 2);
  assert.equal(log.query({ days: 1, key: 'prod' }).total, 1);
  assert.equal(log.query({ days: 1, status: '5xx' }).total, 1);
  assert.equal(log.query({ days: 1, model: 'm1' }).items[0].id, 'r1');
  const cleared = log.clear({ before: new Date(now).toISOString() });
  assert.equal(cleared.removedFiles, 0);
  assert.equal(log.query({ days: 1 }).total, 1);
  await log.stop();
});
