'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/account-state.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
new Function('exports', compiled)(exportsObject);

const {
  isErrorAccountState,
  matchesAccountStateFilter,
  accountStateLabel,
  applyAccountEnabledPatch,
  calculateCacheHitRate
} = exportsObject;

test('error account state helpers recognize all unhealthy gateway states', () => {
  for (const unhealthy of ['verification_required', 'authentication_error', 'access_denied', 'error', 'unknown']) {
    assert.equal(isErrorAccountState(unhealthy), true, unhealthy);
    assert.equal(matchesAccountStateFilter(unhealthy, 'error'), true, unhealthy);
    assert.equal(matchesAccountStateFilter(unhealthy, 'all'), true, unhealthy);
    assert.equal(matchesAccountStateFilter(unhealthy, 'available'), false, unhealthy);
  }
  for (const healthyOrManaged of ['available', 'cooldown', 'disabled']) {
    assert.equal(isErrorAccountState(healthyOrManaged), false, healthyOrManaged);
    assert.equal(matchesAccountStateFilter(healthyOrManaged, 'error'), false, healthyOrManaged);
    assert.equal(matchesAccountStateFilter(healthyOrManaged, healthyOrManaged), true, healthyOrManaged);
  }
  assert.equal(accountStateLabel('disabled'), '已暂停');
  assert.equal(accountStateLabel('verification_required'), '需核验');
  assert.equal(accountStateLabel('authentication_error'), '凭据失效');
  assert.equal(accountStateLabel('access_denied'), '访问受限');
});

test('applyAccountEnabledPatch toggles enabled state without mutating unrelated accounts', () => {
  const initial = [
    { id: 'a1', enabled: true, state: 'available' },
    { id: 'a2', enabled: false, state: 'disabled' }
  ];
  const paused = applyAccountEnabledPatch(initial, 'a1', false);
  assert.deepEqual(paused[0], { id: 'a1', enabled: false, state: 'disabled' });
  assert.deepEqual(paused[1], initial[1]);

  const resumed = applyAccountEnabledPatch(paused, 'a2', true);
  assert.deepEqual(resumed[1], { id: 'a2', enabled: true, state: 'available' });
  assert.deepEqual(resumed[0], paused[0]);
});

test('calculateCacheHitRate uses Gemini inclusive inputTokens denominator', () => {
  assert.equal(calculateCacheHitRate(1000, 800), 80);
  assert.equal(calculateCacheHitRate(1000, 0), 0);
  assert.equal(calculateCacheHitRate(0, 0), null);
  assert.equal(calculateCacheHitRate(undefined, undefined), null);
  assert.equal(calculateCacheHitRate(500, 700), 100);
});
