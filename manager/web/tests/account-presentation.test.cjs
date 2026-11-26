'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/account-presentation.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const helpers = {};
new Function('exports', compiled)(helpers);
const { accountHealth, accountPlan, quotaIsStale, matchesAccountFilter, resetTimeLabel } = helpers;
const base = { enabled: false, state: 'disabled', healthReason: '', healthMessage: '', lastError: '', lastSuccessAt: '', quota: null };

test('pausing an account keeps health and TOS separate from its scheduling switch', () => {
  const tos = { ...base, healthState: 'access_denied', lastError: '403 TOS_VIOLATION' };
  assert.equal(accountHealth(tos).key, 'tos');
  assert.equal(matchesAccountFilter(tos, 'tos'), true);
  assert.equal(matchesAccountFilter(tos, 'disabled'), true);
  assert.equal(matchesAccountFilter(tos, 'healthy'), false);
  assert.equal(accountHealth({ ...tos, enabled: true, state: 'available' }).key, 'tos');
  assert.equal(accountHealth({ ...base, healthState: 'access_denied', healthReason: 'account_access_denied' }).label, '访问受限');
  assert.equal(accountHealth({ ...base, lastError: '403 PERMISSION_DENIED' }).key, 'unknown', 'generic 403 alone does not prove TOS');
  assert.equal(accountHealth(base).label, '待核验');
  assert.equal(accountHealth({ ...base, healthState: 'available', lastSuccessAt: '2026-11-26T01:00:00Z' }).key, 'healthy');
});

test('plans require explicit upstream data rather than quota size or enabled state', () => {
  assert.equal(accountPlan({ ...base, quota: { plan: 'g1-ultra-tier' } }), 'Google AI Ultra');
  assert.equal(accountPlan({ ...base, quota: { plan: 'g1-pro-tier' } }), 'Google AI Pro');
  assert.equal(accountPlan({ ...base, quota: { plan: 'free-tier' } }), 'Starter · 免费');
  assert.equal(accountPlan({ ...base, quota: { groups: [] } }), '套餐待核验');
});

test('expired quota and elapsed reset times never imply replenished balance', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  assert.equal(quotaIsStale({ expiresAt: '2029-12-31T23:59:00Z' }, now), true);
  assert.equal(quotaIsStale({ expiresAt: '2030-01-02T00:00:00Z' }, now), false);
  assert.equal(quotaIsStale({ stale: true }, now), true);
  assert.equal(resetTimeLabel('2029-12-31T23:59:00Z', now), '已到重置时间，待刷新');
  assert.equal(resetTimeLabel('2030-01-01T01:30:00Z', now), '1 小时 30 分后重置');
  assert.equal(resetTimeLabel('', now), '重置时间未知');
});


test('a 429 probe is shown as throttled rather than TOS or healthy', () => {
  const limited = { ...base, enabled: true, state: 'available', healthCheckedAt: '2030-01-01T01:00:00Z', healthCheckStatus: 'rate_limited', lastSuccessAt: '2030-01-01T00:00:00Z' };
  assert.equal(accountHealth(limited).label, '限流（429）');
  assert.equal(matchesAccountFilter(limited, 'tos'), false);
  assert.equal(accountHealth({ ...limited, healthCheckStatus: 'unknown' }).label, '待核验');
  assert.equal(accountHealth({ ...limited, lastSuccessAt: '2030-01-01T02:00:00Z' }).label, '健康');
});
