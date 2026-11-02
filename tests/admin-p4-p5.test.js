'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ModelSettings } = require('../src/model-settings');
const { UsageStore } = require('../src/usage-store');
const { usageSummary } = require('../src/admin-api');
const { RequestLog } = require('../src/request-log');
function fixture(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-admin-')); t.after(() => fs.rmSync(dir, { force: true, recursive: true })); return dir; }

test('model settings survive reload and failed validation is atomic', t => {
  const configDir = fixture(t); const settings = new ModelSettings({ configDir });
  settings.update('model-a', { displayName: 'A', aliases: ['alias-a'], defaultTemperature: 0, defaultMaxTokens: 10, enabled: false });
  assert.equal(new ModelSettings({ configDir }).isDisabled('model-a'), true);
  settings.update('model-b', { aliases: ['alias-b'] });
  const before = fs.readFileSync(settings.file, 'utf8');
  assert.throws(() => settings.update('model-b', { aliases: ['alias-a'] }));
  assert.equal(fs.readFileSync(settings.file, 'utf8'), before);
  assert.deepEqual(settings.get('model-b').aliases, ['alias-b']);
  settings.update('model-a', { enabled: true, defaultTemperature: null });
  assert.equal(settings.isDisabled('model-a'), false);
  assert.equal(settings.get('model-a').defaultTemperature, undefined);
});

test('usage aggregation reconciles all counters for 30 days and distinguishes retries', t => {
  const now = Date.parse('2026-11-02T04:00:00Z');
  let time = now;
  const store = new UsageStore({ configDir: fixture(t), now: () => time });
  for (let day = 0; day < 32; day++) {
    time = now - day * 86400000;
    store.recordClientRequest();
    store.recordUpstream({ model: 'm1', accountId: 'a1', usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } });
    store.recordUpstream({ model: 'm1', accountId: 'a1', success: false });
  }
  const deps = { usageStore: store, accountPool: { status: () => [] }, robinAccountPool: { status: () => [] } };
  for (const groupBy of ['model', 'account']) {
    const result = usageSummary(deps, { days: 30, groupBy, now });
    assert.equal(result.totals.clientRequests, 30);
    assert.equal(result.totals.totalTokens, 420);
    assert.equal(result.items[0].requests, 60);
    assert.equal(result.items[0].successRate, 50);
    assert.equal(result.trend.reduce((n, r) => n + r.tokens, 0), 420);
    assert.equal(result.items.reduce((n, r) => n + r.tokens, 0), result.totals.totalTokens);
  }
  assert.throws(() => usageSummary(deps, { days: 32, now }));
  const keys = usageSummary({ ...deps, keyStore: { list: () => [{ id: 'k1', name: 'K1', usage: { byDay: { '2026-11-02': { tokens: 14, requests: 1 } } } }] } }, { days: 30, groupBy: 'key', now });
  assert.equal(keys.items.reduce((n, r) => n + r.tokens, 0), 420);
  assert.equal(keys.items.find(r => r.id === 'unattributed').tokens, 406);
});

test('log worker queries and clears timestamps while keeping remaining records', async t => {
  const now = Date.now(); const log = new RequestLog({ configDir: fixture(t), now: () => now });
  t.after(() => log.stop());
  for (let i = 0; i < 3; i++) log.record({ at: now - i * 1000, requestId: `r${i}`, model: '测试', status: 200 });
  const query = await log.queryAsync({ model: '测试', size: 1 });
  assert.equal(query.total, 3); assert.equal(query.items[0].id, 'r0');
  await log.clearAsync({ before: new Date(now - 500).toISOString() });
  assert.equal((await log.queryAsync({})).total, 1);
});

test('hourly stacks stay bounded and reconcile; latency is only present with recorded samples', t => {
  const now = Date.parse('2026-11-02T04:00:00Z');
  let time = now;
  const store = new UsageStore({ configDir: fixture(t), now: () => time });
  for (let h = 0; h < 720; h++) {
    time = now - h * 3600000;
    store.recordClientRequest();
    store.recordUpstream({ model: `m${h % 8}`, accountId: 'a', usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, cache_read_tokens: 5 } });
    store.recordRequestMetrics({ model: `m${h % 8}`, account: 'a', latencyMs: 100 + h % 2 });
  }
  const deps = { usageStore: store, accountPool: { status: () => [] }, robinAccountPool: { status: () => [] } };
  const hourly = usageSummary(deps, { now, days: 31, groupBy: 'model', grain: 'hour' });
  assert.ok(hourly.trend.length <= 200);
  assert.equal(hourly.series.length, 6);
  assert.equal(hourly.trend.reduce((n, p) => n + p.tokens, 0), hourly.totals.totalTokens);
  for (const point of hourly.trend) assert.equal(Object.values(point.groups).reduce((a, b) => a + b, 0), point.tokens);
  assert.equal(hourly.items[0].cacheHitRate, 50);
  assert.ok(hourly.items[0].avgLatencyMs >= 100);
  assert.equal(hourly.items.reduce((n, item) => n + item.latencySamples, 0), 720);
  assert.throws(() => usageSummary(deps, { now, days: 7, groupBy: 'key', grain: 'hour' }));
});

test('CSV worker exports filtered results beyond one UI page and removes temporary file', async t => {
  const configDir = fixture(t); const now = Date.now();
  const log = new RequestLog({ configDir, now: () => now });
  t.after(() => log.stop());
  for (let i = 0; i < 300; i++) log.record({ at: now - i, requestId: `r${i}`, model: i % 2 ? 'other' : 'chosen', keyName: '=spreadsheet-formula', status: 200 });
  const file = path.join(configDir, 'export.csv');
  const result = await log.worker('exportCsv', { file, days: 1, model: 'chosen' });
  assert.equal(result.rows, 150);
  const csv = fs.readFileSync(file, 'utf8');
  assert.equal(csv.trim().split('\n').length, 151);
  assert.ok(csv.includes("'=spreadsheet-formula"));
  assert.equal(csv.includes('other'), false);
  fs.rmSync(file);
});

test('request log account column resolves IDs to masked account email', async () => {
  const { handleAdminRequest } = require('../src/admin-api');
  let status, body;
  await handleAdminRequest({
    req: { method: 'GET', socket: {remoteAddress:'127.0.0.1'}, headers:{'x-agy-admin-token':'synthetic-admin'} },
    res: { writeHead: code => {status=code;}, end: text => {body=JSON.parse(text);} },
    route:'/_admin/v1/logs/requests', requestUrl:new URL('http://localhost/_admin/v1/logs/requests'),
    deps: { token:'synthetic-admin', accountPool:{status:()=>[{id:'a1',email:'alice@example.com'}]},
      requestLog:{queryAsync:async()=>({items:[{account:'a1'},{account:'removed'},{account:''}],total:3})} }
  });
  assert.equal(status,200);
  assert.equal(body.data.items[0].accountLabel,'a***e@example.com');
  assert.equal(body.data.items[0].account,'a1');
  assert.equal(body.data.items[1].accountLabel,'已移除账号');
  assert.equal(body.data.items[2].accountLabel,'—');
});

test('account email registry persists labels without credentials and names historical usage', t => {
  const {AccountLabels}=require('../src/account-labels');
  const configDir=fixture(t);const labels=new AccountLabels({configDir});
  labels.capture([{id:'old',email:'archived@example.com',refreshToken:'must-never-save'}]);
  const saved=fs.readFileSync(labels.file,'utf8');
  assert.equal(saved.includes('must-never-save'),false);assert.equal(saved.includes('archived@example.com'),false);
  const restored=new AccountLabels({configDir});
  fs.writeFileSync(labels.file, JSON.stringify({...JSON.parse(saved), external: 'h***l@example.com'}));
  restored.capture([{id:'new',email:'current@example.com'}]);
  assert.equal(new AccountLabels({configDir}).all().external,'h***l@example.com');
  const now=Date.now();const hour=new Date(Math.floor(now/3600000)*3600000).toISOString();
  const result=usageSummary({accountLabels:restored,accountPool:{status:()=>[]},usageStore:{summary:()=>({history:[{at:hour,totalTokens:10}],hourlyByAccount:{[hour]:{old:{totalTokens:10}}}})}},{days:1,groupBy:'account',now});
  assert.equal(result.items[0].name,'a***d@example.com');
  assert.equal(result.series[0].name,'a***d@example.com');
});


test('internal models stay out of all public catalogs after discovery', () => {
  const {publicModels}=require('../src/model-visibility');
  const internal=['tab_flash_lite_preview','tab_jump_flash_lite_preview','chat_20706','chat_23310','gemini-2.5-pro'];
  const input=['gemini-3.8-flash-low',...internal,'claude-sonnet-5-5-low'];
  assert.deepEqual(publicModels(input),['gemini-3.8-flash-low','claude-sonnet-5-5-low']);
  assert.equal(input.length,7);
});
