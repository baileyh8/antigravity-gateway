'use strict';
require('./helpers/gateway-environment');

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ANTIGRAVITY_GATEWAY_TRANSPORT = 'direct';
delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
const { DirectAntigravityProvider, DirectProviderError } = require('../src/direct-provider');
const { errorCategory } = require('../src/account-pool');
const { createServer } = require('../antigravity-gateway');

const detail = 'The input token count exceeds the maximum number of tokens allowed 1048576.';
const overflow = () => new DirectProviderError('Antigravity 直连上游返回错误。', {
  code: 'direct_upstream_error', status: 502, details: detail
});

test('an upstream input overflow is a request error, including errors inside an HTTP 200 stream', () => {
  const error = overflow();
  assert.equal(error.code, 'context_length_exceeded');
  assert.equal(error.status, 400);
  assert.equal(errorCategory(error), 'request', 'input overflow must not rotate or cool down accounts');
  assert.match(error.message, /压缩/);
  assert.equal(error.details, detail);
  const quota = new DirectProviderError('Resource exhausted', { code: 'direct_upstream_error', status: 429 });
  assert.equal(quota.code, 'direct_upstream_error');
  assert.equal(errorCategory(quota), 'quota');
});

test('HTTP errors and Responses stream failures expose a recognizable context overflow', async t => {
  t.mock.method(DirectAntigravityProvider.prototype, 'isConfigured', () => true);
  t.mock.method(DirectAntigravityProvider.prototype, 'listModels', async () => ['gemini-3.8-flash-high']);
  let sends = 0;
  t.mock.method(DirectAntigravityProvider.prototype, 'send', async () => { sends++; throw overflow(); });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const protocol of ['responses', 'chat/completions', 'messages']) {
    const response = await fetch(`${base}/v1/${protocol}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.8-flash-high', stream: false,
        ...(protocol === 'responses' ? { input: 'synthetic context' } : { messages: [{ role: 'user', content: 'synthetic context' }] }) })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.type, 'context_length_exceeded');
    assert.match(body.error.message, /压缩/);
  }
  for (const tools of [[], [{ type: 'function', name: 'inspect', parameters: { type: 'object' } }]]) {
    const response = await fetch(`${base}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.8-flash-high', input: 'synthetic context', stream: true, tools })
    });
    assert.equal(response.status, 200, 'SSE was admitted before the upstream rejection');
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
      .map(line => JSON.parse(line.slice(6)));
    const failed = events.find(event => event.type === 'response.failed');
    assert.equal(failed.response.status, 'failed');
    assert.equal(failed.response.error.code, 'context_length_exceeded');
    assert.match(failed.response.error.message, /压缩/);
    assert.equal(failed.response.id, events.find(event => event.type === 'response.created').response.id);
    assert.deepEqual(events.map(event => event.sequence_number), events.map((_, index) => index));
    assert.equal(events.some(event => event.type === 'response.completed'), false);
  }
  assert.equal(sends, 5, 'no automatic replay of a permanent input error');
});
