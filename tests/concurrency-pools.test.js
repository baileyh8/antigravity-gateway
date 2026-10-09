'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-pools-'));
process.env.ANTIGRAVITY_GATEWAY_CONFIG_DIR = directory;
process.env.ANTIGRAVITY_GATEWAY_TRANSPORT = 'direct';
process.env.ANTIGRAVITY_GATEWAY_MEDIA_CONCURRENCY = '4';
process.env.ANTIGRAVITY_GATEWAY_IMAGE_CONCURRENCY = '4';
process.env.ANTIGRAVITY_GATEWAY_RESOLVED_MEDIA_MEMORY_BYTES = '1024';
delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
const { AccountPool } = require('../src/account-pool');
const { MediaStore, MultimediaError } = require('../src/multimedia');
const { createServer, runTurn, concurrencySnapshot } = require('../antigravity-gateway');
const { normalizeChat } = require('../src/protocol');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(predicate) {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('concurrency condition timed out');
}
const textTurn = () => normalizeChat({ messages: [{ role: 'user', content: 'draw a circle' }] });
const mediaTurn = (mime = 'image/png', bytes = 8) => normalizeChat({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${Buffer.alloc(bytes).toString('base64')}` } }] }] });
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('four image APIs and four mixed media/uploads run independently; excess queue and cancellation releases capacity', async t => {
  const imageGate = deferred(), mediaGate = deferred();
  const jobs = [];
  t.after(async () => { imageGate.resolve(); mediaGate.resolve(); await Promise.allSettled(jobs); });
  t.mock.method(AccountPool.prototype, 'generateImage', async () => { await imageGate.promise; return { data: 'YWJj', mimeType: 'image/png', usage: {} }; });
  t.mock.method(AccountPool.prototype, 'send', async () => { await mediaGate.promise; return { text: 'ok', toolCalls: [], usage: {} }; });
  const save = MediaStore.prototype.saveAsync;
  t.mock.method(MediaStore.prototype, 'saveAsync', async function(buffer, options) { if (options.purpose !== 'generated') await mediaGate.promise; return save.call(this, buffer, options); });
  const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => { assert.equal(r.status, 200, await r.text()); });
  for (let i = 0; i < 4; i++) jobs.push(post('/v1/images/generations', { prompt: 'circle' }));
  jobs.push(post('/v1/files', { filename: 'test.txt', data: 'YWJj' }));
  for (const mime of ['image/png', 'video/mp4', 'application/pdf']) jobs.push(runTurn(mediaTurn(mime), 'gemini-test', new AbortController().signal));
  await until(() => concurrencySnapshot().images.active === 4 && concurrencySnapshot().media.active === 4);
  jobs.push(post('/v1/images/generations', { prompt: 'fifth' }));
  const cancel = new AbortController();
  const cancelled = runTurn(mediaTurn(), 'gemini-test', cancel.signal);
  const rejection = assert.rejects(cancelled, { code: 'request_aborted' });
  await until(() => concurrencySnapshot().images.queued === 1 && concurrencySnapshot().media.queued === 1);
  cancel.abort(); await rejection;
  assert.equal(concurrencySnapshot().media.queued, 0);
  imageGate.resolve(); mediaGate.resolve(); await Promise.all(jobs);
  assert.equal(concurrencySnapshot().images.active, 0);
  assert.equal(concurrencySnapshot().media.active, 0);
  assert.equal(concurrencySnapshot().memory.resolvedMedia.used, 0);
});

test('native image tools use the image pool, not media slots, and failures release permits', async t => {
  const gate = deferred(); let entered = 0;
  t.mock.method(AccountPool.prototype, 'send', async () => ({ text: '', toolCalls: [{ id: 'image', name: 'generate_image', arguments: { Prompt: 'circle' } }], usage: {} }));
  t.mock.method(AccountPool.prototype, 'generateImage', async () => { entered++; await gate.promise; throw new Error('generation failed'); });
  const jobs = Array.from({ length: 5 }, () => assert.rejects(runTurn(textTurn(), 'gemini-test', new AbortController().signal), /generation failed/));
  t.after(async () => { gate.resolve(); await Promise.allSettled(jobs); });
  await until(() => entered === 4 && concurrencySnapshot().images.queued === 1);
  assert.equal(concurrencySnapshot().media.active, 0);
  gate.resolve(); await Promise.all(jobs);
  assert.equal(entered, 5);
  assert.equal(concurrencySnapshot().images.active, 0);
  assert.equal(concurrencySnapshot().requests.active, 0);
});

test('resolved media budget rejects overload with 503 and is reusable after errors', async t => {
  await assert.rejects(runTurn(mediaTurn('video/mp4', 300), 'gemini-test', new AbortController().signal), { code: 'memory_budget_exceeded', status: 503 });
  t.mock.method(AccountPool.prototype, 'send', async () => { throw new Error('provider failed'); });
  await assert.rejects(runTurn(mediaTurn(), 'gemini-test', new AbortController().signal), /provider failed/);
  assert.equal(concurrencySnapshot().memory.resolvedMedia.used, 0);
  assert.equal(concurrencySnapshot().media.active, 0);
});

test('stored/local/remote media reserve before buffering and propagate budget errors', async t => {
  const store = new MediaStore({ directory: path.join(directory, 'budget-test') });
  const saved = await store.saveAsync(Buffer.from('abc'), { filename: 'x.mp4' });
  const reserveBytes = bytes => { assert.equal(bytes, 3); throw new MultimediaError('budget', { status: 503, code: 'memory_budget_exceeded' }); };
  for (const part of [{ fileId: saved.id }, { url: `https://gateway.test/v1/files/${saved.id}/content` }, { filePath: store.contentPath(saved.id) }]) {
    await assert.rejects(store.resolve(part, { reserveBytes }), { status: 503 });
  }
  let cancelled = false;
  store.fetchImpl = async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, cancel() { cancelled = true; } }));
  await assert.rejects(store.resolve({ url: 'https://8.8.8.8/video.mp4' }, { reserveBytes }), { status: 503 });
  assert.equal(cancelled, true);
});
