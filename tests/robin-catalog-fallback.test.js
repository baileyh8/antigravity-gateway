'use strict';
const { directory } = require('./helpers/gateway-environment');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const run = promisify(execFile);
const cloudModels = ['claude-opus-4-6-thinking', 'claude-sonnet-4-6', 'gemini-test-high', 'gemini-test-low'];

async function catalogCase({ transport = 'agy', agy = false, robin = true, exerciseProtocols = false }) {
  // Each case imports a fresh gateway with a disposable account directory. The
  // missing CLI is a real ENOENT; successful CLI discovery uses the local fake.
  // Robin is synthetic here: this never reads production grants or uses quota.
  const configDir = path.join(directory, `case-${transport}-${agy}-${robin}`);
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { DirectAntigravityProvider } = require('./src/direct-provider');
    const { RobinAccountPool } = require('./src/robin-account-pool');
    DirectAntigravityProvider.prototype.isConfigured = () => false;
    let robinCatalogCalls = 0, robinSendCalls = 0;
    RobinAccountPool.prototype.listModels = async () => {
      robinCatalogCalls++;
      ${robin ? "return ['gemini-4-argon'];" : "throw new Error('synthetic Robin directory unavailable');"}
    };
    RobinAccountPool.prototype.send = async (_input, model) => {
      if (model !== 'gemini-4-argon') throw new Error('unexpected model');
      robinSendCalls++;
      return { text: '橙色笔记。', toolCalls: [], finishReason: 'stop', usage: null, usageKnown: false, providerType: 'robin' };
    };
    const gateway = require('./antigravity-gateway');
    (async () => {
      const server = gateway.createServer();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        const response = await fetch(base + '/v1/models');
        const body = await response.json();
        const result = { status: response.status, body };
        if (response.ok) {
          result.refreshed = await gateway.refreshClientModelCatalogs();
          result.claude = JSON.parse(fs.readFileSync(gateway.claudeConfigPath(), 'utf8'));
          result.codex = JSON.parse(fs.readFileSync(gateway.codexCatalogPath(), 'utf8'));
          result.banner = gateway.startupBanner({ models: result.refreshed, modelError: 'optional local CLI unavailable' });
        }
        result.protocols = [];
        if (${exerciseProtocols}) for (const endpoint of ['messages', 'chat/completions', 'responses']) {
          const request = await fetch(base + '/v1/' + endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gemini-4-argon', max_tokens: 32,
              ...(endpoint === 'responses' ? { input: '回复橙色笔记。' } : { messages: [{ role: 'user', content: '回复橙色笔记。' }] }) })
          });
          result.protocols.push({ endpoint, status: request.status, body: await request.json() });
        }
        result.robinCatalogCalls = robinCatalogCalls;
        result.robinSendCalls = robinSendCalls;
        console.log('CASE_RESULT:' + JSON.stringify(result));
      } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const { stdout } = await run(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), timeout: 8000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ANTIGRAVITY_GATEWAY_CONFIG_DIR: configDir,
      ANTIGRAVITY_GATEWAY_TRANSPORT: transport, ANTIGRAVITY_GATEWAY_API_KEY: '',
      ANTIGRAVITY_CLI_PATH: agy ? process.execPath : path.join(configDir, 'no-local-agy'),
      ANTIGRAVITY_CLI_PREFIX_ARGS: JSON.stringify(agy ? [path.join(__dirname, 'fixtures/fake-agy.js')] : []) }
  });
  const line = stdout.split('\n').find(line => line.startsWith('CASE_RESULT:'));
  assert.ok(line, stdout);
  return JSON.parse(line.slice('CASE_RESULT:'.length));
}

function assertCatalogs(result, models) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.data.map(item => item.id).sort(), [...models].sort());
  assert.deepEqual(result.refreshed.sort(), [...models].sort());
  assert.deepEqual(result.claude.modelPicker.options.map(item => item.model).sort(), [...models].sort());
  assert.deepEqual(result.codex.models.map(item => item.slug).sort(), [...models].sort());
  assert.deepEqual(result.codex.data.map(item => item.id).sort(), [...models].sort());
  if (models.includes('gemini-4-argon')) {
    // DSH selects data[] even when the Codex models[] array is present.
    for (const catalog of [result.body, result.codex]) {
      const item = catalog.data.find(item => item.id === 'gemini-4-argon');
      assert.equal(item.context_window, 1048576);
      assert.equal(item.max_output_tokens, 65536);
      assert.equal(item.context_window_shared, true);
      assert.equal(item.gateway_limits_verified, false);
      assert.equal(item.video_route, 'cloudcode_default_model');
      assert.deepEqual(item.input_modalities, ['text', 'image', 'video', 'audio', 'pdf']);
      assert.equal(item.supports_function_calling, true);
      assert.match(item.metadata_source, /^https:\/\/ai\.google\.dev\//);
      assert.equal(item.supported_reasoning_levels, undefined);
      const codex = catalog.models.find(item => item.slug === 'gemini-4-argon');
      assert.equal(codex.context_window, item.context_window);
      assert.equal(codex.max_context_window, item.context_window);
      assert.equal(codex.max_output_tokens, item.max_output_tokens);
      assert.deepEqual(codex.supported_reasoning_levels, []);
      assert.equal(codex.default_reasoning_level, null);
    }
    for (const item of result.body.data.filter(item => item.id !== 'gemini-4-argon')) {
      assert.equal(item.metadata_scope, undefined);
    }
  }

}

for (const transport of ['agy', 'auto']) test(`Robin-only catalogs and all three protocols work without a local CLI in ${transport} mode`, async () => {
  const result = await catalogCase({ transport, exerciseProtocols: true });
  assertCatalogs(result, ['gemini-4-argon']);
  assert.ok(result.robinCatalogCalls > 0, 'missing agy must not skip the independent Robin directory');
  assert.equal(result.robinSendCalls, 3);
  assert.match(result.banner, /gemini-4-argon/);
  assert.match(result.banner, /Gemini App:.*Robin/);
  assert.doesNotMatch(result.banner, /检测失败/);
  assert.ok(result.protocols.every(reply => reply.status === 200), JSON.stringify(result.protocols));
  assert.ok(result.protocols.every(reply => JSON.stringify(reply.body).includes('橙色笔记。')));
});

test('a failed Robin directory does not hide working subprocess models or their client configuration files', async () => {
  assertCatalogs(await catalogCase({ agy: true, robin: false }), cloudModels);
});

test('subprocess and Robin discovery still produce one exact union for every model artifact', async () => {
  assertCatalogs(await catalogCase({ agy: true }), [...cloudModels, 'gemini-4-argon']);
});

test('a fresh installation with both catalogs unavailable preserves a real discovery error instead of inventing models', async () => {
  const result = await catalogCase({ robin: false });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.type, 'agy_not_found');
  assert.ok(result.robinCatalogCalls > 0, 'both independent providers must have been attempted');
  assert.equal(result.refreshed, undefined);
});
