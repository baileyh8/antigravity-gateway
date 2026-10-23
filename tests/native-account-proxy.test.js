'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProxyManager } = require('../src/proxy-manager');
const { nativeCloudCodeFetch, closeNativeTransport } = require('../src/agy-native-transport');

test('native Cloud Code keeps separate account exits even when NO_PROXY matches Google', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-proxy-'));
  const previous = process.env.NO_PROXY;
  process.env.NO_PROXY = '*';
  const seen = [];
  const servers = [];
  const manager = new ProxyManager({ configDir: directory });
  t.after(async () => {
    await manager.close({ force: true }); closeNativeTransport();
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (previous === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const id of ['one', 'two']) {
    const server = http.createServer((req, res) => { seen.push([id, req.url]); res.end(id); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
    manager.upsert({ id, url: `http://127.0.0.1:${server.address().port}` }); manager.bind(id, id);
  }
  const url = 'http://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
  assert.deepEqual(await Promise.all(['one', 'two'].map(async id => {
    const response = await manager.accountFetch(id, nativeCloudCodeFetch)(url);
    return response.text();
  })), ['one', 'two']);
  assert.deepEqual(seen.map(x => x[0]).sort(), ['one', 'two']);
  assert.ok(seen.every(x => x[1] === url));
  assert.equal(manager.active.get('one'), 0); assert.equal(manager.active.get('two'), 0);
  await assert.rejects(async () => nativeCloudCodeFetch(url, { dispatcher: {} }), { code: 'native_proxy_required' });
  manager.state.bindings.one = 'missing';
  await assert.rejects(manager.accountFetch('one', nativeCloudCodeFetch)(url));
  assert.equal(seen.length, 2);
});
