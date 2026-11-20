'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-retry-stack-'));
process.env.ANTIGRAVITY_GATEWAY_CONFIG_DIR = directory;
const { AccountStore } = require('../src/account-store');
const { AccountPool } = require('../src/account-pool');
const { DirectAntigravityProvider } = require('../src/direct-provider');
const { normalizeResponses } = require('../src/protocol');
const { closeSchemaWorkers } = require('../src/schema-contract');
test.after(async () => {
  await closeSchemaWorkers();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('account pool and direct provider stop unspecified exhaustion across endpoint and retry budgets', async () => {
  const model = 'gemini-4-argon-high';
  const store = new AccountStore({ configDir: directory });
  for (const email of ['first@example.com', 'second@example.com']) {
    store.save({ email, accessToken: 'synthetic-token', projectId: 'synthetic-project' });
  }
  let posts = 0;
  const selected = [];
  const pool = new AccountPool({ store, fallbackProvider: {}, providerFactory: () => {
    const provider = new DirectAntigravityProvider({
      localAuth: null, accessToken: 'synthetic-token', projectId: 'synthetic-project',
      maxRetries: 2, retryBaseMs: 1,
      fetchImpl: async (url, options) => {
        assert.match(url, /streamGenerateContent/);
        assert.equal(options.method, 'POST');
        posts++;
        return new Response(JSON.stringify({ error: {
          code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource exhausted'
        } }), { status: 429 });
      }
    });
    assert.equal(provider.baseUrls().length, 2);
    provider.listModels = async () => [model];
    return provider;
  }});
  const normalized = normalizeResponses({ model, input: [
    { role: 'developer', content: 'Keep authorization and tool permissions intact.' },
    { role: 'user', content: 'Synthetic fixture. Reply OK.' }
  ] });
  await assert.rejects(pool.send(normalized, model, {
    sessionId: 'synthetic-desktop-first-429',
    onAccountSelected: ({ accountId }) => selected.push(accountId)
  }), error => error.status === 429 && error.retryAfterMs >= 59000
    && JSON.parse(error.details).error.status === 'RESOURCE_EXHAUSTED');
  assert.equal(posts, 1);
  assert.equal(selected.length, 1);
});
