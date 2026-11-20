'use strict';
require('./helpers/gateway-environment');
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ANTIGRAVITY_GATEWAY_TRANSPORT = 'direct';
delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
const { DirectAntigravityProvider, DirectProviderError } = require('../src/direct-provider');
const { createServer } = require('../antigravity-gateway');

test('streaming Responses returns capacity HTTP 503 and retry timing before opening SSE by default', async t => {
  t.mock.method(DirectAntigravityProvider.prototype, 'isConfigured', () => true);
  t.mock.method(DirectAntigravityProvider.prototype, 'listModels', async () => ['gemini-3.8-flash-high']);
  let calls = 0;
  t.mock.method(DirectAntigravityProvider.prototype, 'send', async () => {
    calls++;
    throw new DirectProviderError('Synthetic model capacity failure', { code: 'direct_upstream_error', status: 503,
      details: JSON.stringify(require('./fixtures/agy-capacity-error-20261118.json')), retryAfterMs: 125000 });
  });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-3.8-flash-high', input: 'Synthetic fixture', stream: true })
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '125');
  assert.match(response.headers.get('content-type'), /application\/json/);
  const body = await response.json();
  assert.equal(body.error.code, 'model_capacity_exhausted');
  assert.equal(body.error.upstream_reason, 'MODEL_CAPACITY_EXHAUSTED');
  assert.equal(body.error.resets_in_seconds, 125);
  assert.equal(calls, 1);
});
