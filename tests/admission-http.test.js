'use strict';
require('./helpers/gateway-environment');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.ANTIGRAVITY_GATEWAY_TRANSPORT = 'agy';
process.env.ANTIGRAVITY_GATEWAY_MAX_CONCURRENCY = '1';
process.env.ANTIGRAVITY_GATEWAY_MAX_QUEUE = '1';
process.env.ANTIGRAVITY_GATEWAY_QUEUE_TIMEOUT_MS = '30';
process.env.ANTIGRAVITY_CLI_PATH = process.execPath;
process.env.ANTIGRAVITY_CLI_PREFIX_ARGS = JSON.stringify([path.join(__dirname,'fixtures/fake-agy.js')]);
process.env.ANTIGRAVITY_DEFAULT_MODEL = 'gemini-test-high';
delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
const { createServer } = require('../antigravity-gateway');
const { executionSlots } = require('../src/admission-control');

test('queued streaming and non-streaming requests return HTTP 429 with Retry-After before SSE opens', async t => {
  const server = createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const release = await executionSlots.acquire();
  try {
    for (const stream of [false,true]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'gemini-test-high',messages:[{role:'user',content:'hello'}],stream})});
      assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'1');
      const body=await response.json();assert.equal(body.error.type,'queue_timeout');
      assert.equal(executionSlots.waiters.length,0);
    }
  } finally { release(); }
  assert.equal(executionSlots.active,0);
});
