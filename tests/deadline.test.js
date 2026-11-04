'use strict';
require('./helpers/gateway-environment');
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ANTIGRAVITY_GATEWAY_TIMEOUT_MS = '80';
process.env.ANTIGRAVITY_GATEWAY_TRANSPORT = 'direct';
delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
const { DirectAntigravityProvider } = require('../src/direct-provider');
DirectAntigravityProvider.prototype.listModels = async () => ['gemini-test'];
DirectAntigravityProvider.prototype.isConfigured = () => true;
DirectAntigravityProvider.prototype.send = async function (_input, _model, { signal }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
};
const { createServer } = require('../antigravity-gateway');
const { RequestLog } = require('../src/request-log');

test('direct request deadline returns 504 and the server remains usable', async (t) => {
  const records = [];
  t.mock.method(RequestLog.prototype, 'record', entry => records.push({ ...entry }));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-test', max_tokens: 32, messages: [{ role: 'user', content: 'test' }] })
  });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.type, 'request_timeout');
  assert.equal(records[0].status, 504);
  assert.equal(records[0].code, 'request_timeout');
  assert.equal((await fetch(`${base}/api/hello`)).status, 200);
});

test('Responses deadlines terminate admitted empty, partial and tool streams and log effective failures', async t => {
  const records = [];
  t.mock.method(RequestLog.prototype, 'record', entry => records.push({ ...entry }));
  let partial = false;
  t.mock.method(DirectAntigravityProvider.prototype, 'send', async (_input, _model, { signal, onDelta }) => {
    if (partial) await onDelta?.('Partial answer');
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const variant of ['empty', 'partial', 'tools']) {
    partial = variant === 'partial';
    const response = await fetch(`${base}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-test', input: 'synthetic timeout', stream: true,
        ...(variant === 'tools' ? { tools: [{ type: 'function', name: 'inspect', parameters: { type: 'object' } }] } : {}) })
    });
    assert.equal(response.status, 200, 'admitted SSE headers cannot change to HTTP 504');
    const events = (await response.text()).split('\n')
      .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
      .map(line => JSON.parse(line.slice(6)));
    assert.equal(events.filter(e => e.type === 'response.failed').length, 1);
    assert.equal(events.some(e => e.type === 'response.completed'), false);
    const failed = events.at(-1).response;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.code, 'request_timeout');
    assert.equal(failed.id, events.find(e => e.type === 'response.created').response.id);
    assert.deepEqual(events.map(e => e.sequence_number), events.map((_, i) => i));
    assert.equal(failed.output[0]?.content[0]?.text || '', partial ? 'Partial answer' : '');
    assert.equal(records.at(-1).status, 504, 'request log must classify a timed-out SSE as a failure');
    assert.equal(records.at(-1).code, 'request_timeout', 'abort rejection must not overwrite the deadline cause');
  }
  t.mock.method(DirectAntigravityProvider.prototype, 'send', async () => ({ text: 'Recovered', toolCalls: [], usage: {} }));
  const recovered = await fetch(`${base}/v1/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-test', input: 'synthetic recovery' })
  });
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).status, 'completed');
  assert.equal(records.at(-1).status, 200);
  assert.equal(records.at(-1).code, '');
});
