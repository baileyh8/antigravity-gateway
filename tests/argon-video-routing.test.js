'use strict';
require('./helpers/gateway-environment');
const assert = require('node:assert/strict');
const test = require('node:test');
process.env.ANTIGRAVITY_GATEWAY_TRANSPORT = 'direct';
const { AccountPool } = require('../src/account-pool');
const { ModelSettings } = require('../src/model-settings');
const ARGON_MODEL = 'gemini-4-argon';
const { normalizeChat } = require('../src/protocol');
const { buildDirectRequest } = require('../src/direct-provider');
const { codexCatalogBody, createServer, runTurn } = require('../antigravity-gateway');

test('Argon tiers keep captured enums, limits and thinking levels in requests and both catalogs', t => {
  t.mock.method(AccountPool.prototype, 'modelInfo', () => null);
  const enumByTier = { low: 'M419', medium: 'M418', high: 'M417' };
  const models = Object.keys(enumByTier).map(tier => `${ARGON_MODEL}-${tier}`);
  const catalog = codexCatalogBody(models);
  for (const [tier, modelEnum] of Object.entries(enumByTier)) {
    const model = `${ARGON_MODEL}-${tier}`;
    const thinking = { includeThoughts: true, thinkingLevel: tier.toUpperCase() };
    const normalized = normalizeChat({ model, reasoning_effort: 'xhigh', messages: [{ role: 'user', content: 'Fixture.' }] });
    const { request } = buildDirectRequest(normalized, model, 'fixture-project', 'fixture-session');
    assert.equal(request.labels.model_enum, `MODEL_PLACEHOLDER_${modelEnum}`);
    assert.deepEqual(request.generationConfig, { maxOutputTokens: 65536, thinkingConfig: thinking });
    for (const entry of [catalog.data.find(row => row.id === model), catalog.models.find(row => row.slug === model)]) {
      assert.equal(entry.context_window, 1048576);
      assert.equal(entry.max_output_tokens, 65536);
      assert.deepEqual(entry.fixed_thinking_config, thinking);
    }
  }
});

test('base Argon honors manual limits consistently across both catalogs', t => {
  t.mock.method(ModelSettings.prototype, 'get', id => id === ARGON_MODEL ? { contextWindow: 650000, maxOutputTokens: 12000 } : {});
  const { data, models } = codexCatalogBody([ARGON_MODEL]);
  for (const entry of [data[0], models[0]]) {
    assert.equal(entry.context_window, 650000);
    assert.equal(entry.max_output_tokens, 12000);
    assert.equal(entry.default_reasoning_level, null);
    assert.equal(entry.video_route, 'cloudcode_default_model');
  }
});

test('Argon video understanding uses the original Cloud Code multimodal route only for video turns', async t => {
  const cloud = [];
  t.mock.method(AccountPool.prototype, 'send', async (normalized, model) => {
    cloud.push({ normalized, model });
    return { text: 'cloud-video-analysis', toolCalls: [], usage: {} };
  });
  const video = normalizeChat({
    model: ARGON_MODEL,
    messages: [{ role: 'user', content: [
      { type: 'text', text: '分析这段视频。' },
      { type: 'input_video', video_url: `data:video/mp4;base64,${Buffer.from('synthetic-video').toString('base64')}` }
    ] }]
  });
  const videoResult = await runTurn(video, ARGON_MODEL, new AbortController().signal, { sessionId: 'video' });
  assert.equal(videoResult.text, 'cloud-video-analysis');
  assert.equal(cloud.length, 1);
  assert.equal(cloud[0].model, 'gemini-3.8-flash-high');
  assert.equal(cloud[0].normalized.system, video.system);
  assert.equal(cloud[0].normalized.messages[0].parts[1].mediaType, 'video/mp4');

  const text = normalizeChat({ model: ARGON_MODEL, messages: [{ role: 'user', content: '只处理文本。' }] });
  const textResult = await runTurn(text, ARGON_MODEL, new AbortController().signal, { sessionId: 'text' });
  assert.equal(textResult.text, 'cloud-video-analysis');
  assert.equal(cloud.length, 2);
});

test('all three public protocols route Argon video turns through Cloud Code', async t => {
  delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
  const cloud = [];
  t.mock.method(AccountPool.prototype, 'send', async (normalized, model) => {
    cloud.push({ normalized, model });
    return { text: 'cloud-video-analysis', toolCalls: [], usage: {} };
  });

  const dataUrl = `data:video/mp4;base64,${Buffer.from('synthetic-video').toString('base64')}`;
  const cases = [
    ['/v1/messages', {
      model: ARGON_MODEL,
      max_tokens: 32,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '分析这段视频。' },
        { type: 'video', source: { type: 'base64', media_type: 'video/mp4', data: dataUrl } }
      ] }]
    }],
    ['/v1/chat/completions', {
      model: ARGON_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '分析这段视频。' },
        { type: 'input_video', video_url: dataUrl }
      ] }]
    }],
    ['/v1/responses', {
      model: ARGON_MODEL,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: '分析这段视频。' },
        { type: 'input_video', video_url: dataUrl }
      ] }]
    }]
  ];

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const [endpoint, payload] of cases) {
    const response = await fetch(base + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    assert.equal(response.status, 200, `${endpoint}: ${JSON.stringify(body)}`);
    assert.equal(response.headers.get('x-antigravity-model'), ARGON_MODEL, endpoint);
  }

  assert.equal(cloud.length, cases.length);
  for (const call of cloud) {
    assert.equal(call.model, 'gemini-3.8-flash-high');
    assert.equal(call.normalized.messages[0].parts.find(part => part.type === 'media').mediaType, 'video/mp4');
  }
});

test('Argon video routing rejects a fallback model alias that loops back to Argon', async t => {
  const previous = process.env.ANTIGRAVITY_MODEL_ALIASES;
  t.after(() => {
    if (previous === undefined) delete process.env.ANTIGRAVITY_MODEL_ALIASES;
    else process.env.ANTIGRAVITY_MODEL_ALIASES = previous;
  });
  process.env.ANTIGRAVITY_MODEL_ALIASES = JSON.stringify({
    'gemini-3.8-flash-high': ARGON_MODEL
  });
  const video = normalizeChat({
    model: ARGON_MODEL,
    messages: [{ role: 'user', content: [{
      type: 'input_video',
      video_url: `data:video/mp4;base64,${Buffer.from('synthetic-video').toString('base64')}`
    }] }]
  });
  await assert.rejects(
    runTurn(video, ARGON_MODEL, new AbortController().signal, { sessionId: 'loop' }),
    { code: 'argon_video_fallback_unavailable', status: 503 }
  );
});
