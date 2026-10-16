'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RobinOnboarding } = require('../src/robin-onboarding');
const { AccountStore } = require('../src/account-store');
const { ProxyManager } = require('../src/proxy-manager');
const { RobinOAuthFlow } = require('../src/robin-oauth-flow');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-add-'));
  const manager = new ProxyManager({ configDir: dir });
  manager.upsert({ id: 'us', url: 'http://127.0.0.1:9876' });
  const store = new AccountStore({ configDir: dir, directoryName: 'robin-accounts' });
  let reloads = 0;
  const pool = { reload() { reloads++; }, async listModels() {}, async refreshQuota() {}, status() { return store.list().map(a => ({ id: a.id, models: ['gemini-4-argon'] })); } };
  const flowFactory = () => ({
    start({ onReady, signal, openBrowser }) {
      assert.equal(openBrowser, false);
      return new Promise((resolve, reject) => {
        this.submit = () => resolve({ providerType: 'robin', email: 'fixture@example.test', subjectId: 'fixture', accessToken: 'secret-access', refreshToken: 'secret-refresh' });
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        onReady({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Foauth2callback' });
      });
    }
  });
  const service = new RobinOnboarding({ manager, store, pool, flowFactory });
  t.after(async () => { await service.stop(); await manager.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, manager, store, reloads: () => reloads };
}
const callback = 'http://127.0.0.1:12345/oauth2callback?state=fixture-state&code=private-code';
test('remote-browser onboarding validates state and callback address, persists and binds before discovery', async t => {
  const { service, manager, store, reloads } = setup(t);
  await assert.rejects(service.start('missing'));
  const s = await service.start('us');
  assert.equal(s.state, 'waiting'); assert.ok(s.url.startsWith('https://accounts.google.com/'));
  await assert.rejects(service.start('us'), /已有授权/);
  assert.throws(() => manager.upsert({ id: 'us', url: 'http://127.0.0.1:9877' }), /在途/);
  for (const bad of ['private-code', callback.replace('fixture-state', 'wrong'), callback.replace('12345', '54321'), callback + '&state=fixture-state', callback + '&code=extra']) assert.throws(() => service.submit(s.id, bad));
  assert.equal(service.status().state, 'waiting');
  service.submit(s.id, callback); await service.current.done;
  assert.equal(service.status().state, 'complete'); assert.equal(store.list().length, 1); assert.equal(reloads(), 1);
  assert.equal(manager.state.bindings['robin:' + store.list()[0].id], 'us');
  assert.equal(manager.active.get('us'), 0);
  assert.ok(!JSON.stringify(service.status()).includes('secret')); assert.ok(!JSON.stringify(service.status()).includes('private-code'));
  const again = await service.start('us'); service.submit(again.id, callback); await service.current.done;
  assert.equal(store.list().length, 1); assert.equal(service.status().state, 'failed');
});
test('cancelled authorization saves no account and frees the proxy lease', async t => {
  const { service, store, manager } = setup(t);
  const s = await service.start('us');service.cancel(s.id);await service.current.done;
  assert.equal(service.status().state, 'cancelled');assert.equal(store.list().length, 0);assert.equal(manager.active.get('us'), 0);
  assert.throws(() => service.submit(s.id, callback));
});
test('OAuth external cancellation closes callback listener without exchanging tokens or opening VPS browser', async () => {
  let fetches=0,opens=0; const controller=new AbortController();
  const flow=new RobinOAuthFlow({fetchImpl:async()=>{fetches++;throw Error('must not fetch')},openBrowserImpl:()=>{opens++;}});
  await assert.rejects(flow.start({signal:controller.signal,openBrowser:false,onReady:()=>controller.abort(new Error('cancelled'))}),/cancelled/);
  assert.equal(flow.active,null);assert.equal(fetches,0);assert.equal(opens,0);
});
