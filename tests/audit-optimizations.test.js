'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveClientIp } = require('../src/client-ip');
const { KeyStore } = require('../src/key-store');
const { handleAdminRequest } = require('../src/admin-api');

test('resolveClientIp blocks spoofed X-Forwarded-For from untrusted sockets and extracts rightmost untrusted hop behind loopback proxy', () => {
  // Direct untrusted client spoofing X-Forwarded-For must be ignored.
  assert.equal(resolveClientIp({
    socket: { remoteAddress: '203.0.113.55' },
    headers: { 'x-forwarded-for': '10.0.0.1' }
  }), '203.0.113.55');

  // Client prepending spoofed allowlisted IP behind local nginx reverse proxy.
  assert.equal(resolveClientIp({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '10.0.0.1, 198.51.100.77' }
  }), '198.51.100.77');

  // IPv4-mapped IPv6 loopback proxy also trusts rightmost non-loopback hop.
  assert.equal(resolveClientIp({
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: { 'x-forwarded-for': '10.0.0.1, 198.51.100.88, 127.0.0.1' }
  }), '198.51.100.88');

  // Explicit none disables forwarding headers completely.
  assert.equal(resolveClientIp({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.77', 'x-real-ip': '198.51.100.77' }
  }, { trustProxy: 'none' }), '127.0.0.1');
});

test('KeyStore rejects spoofed forwarded IP, validates expiresAt, and prunes stale rate entries', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-keystore-opt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let current = Date.parse('2026-11-23T00:00:00Z');
  const store = new KeyStore({ configDir: directory, pepper: 'pepper-secret', multiKey: true, now: () => current });
  t.after(() => store.stop());

  assert.throws(() => store.create({ name: 'bad-expiry', expiresAt: 'not-a-date' }), (error) => error.status === 400);

  const created = store.create({ name: 'allowlisted', ipAllowlist: ['10.0.0.0/8'], ratePerMin: 2 });
  assert.throws(() => store.update(created.key.id, { expiresAt: 'invalid-date' }), (error) => error.status === 400);

  // Untrusted remote spoofing X-Forwarded-For cannot bypass allowlist.
  const spoofedDirect = store.authenticate({
    socket: { remoteAddress: '203.0.113.10' },
    headers: { authorization: `Bearer ${created.secret}`, 'x-forwarded-for': '10.1.2.3' }
  });
  assert.equal(spoofedDirect.error.code, 'ip_not_allowed');

  // Behind loopback proxy, spoofed leftmost hop still cannot bypass allowlist.
  const spoofedProxy = store.authenticate({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { authorization: `Bearer ${created.secret}`, 'x-forwarded-for': '10.1.2.3, 203.0.113.10' }
  });
  assert.equal(spoofedProxy.error.code, 'ip_not_allowed');

  // Genuine allowlisted hop behind loopback proxy passes and populates rate map.
  const ok = store.authenticate({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { authorization: `Bearer ${created.secret}`, 'x-forwarded-for': '10.1.2.3' }
  });
  assert.equal(ok.error, undefined);
  assert.equal(store.rate.size, 1);

  // Advancing past the minute boundary lets flush() prune stale rate entries.
  current += 120_000;
  store.flush();
  assert.equal(store.rate.size, 0);
});

test('admin-api honors /_admin/v1/models?force=1 and guards headersSent failures', async () => {
  const calls = [];
  const makeRes = () => {
    const res = {
      statusCode: 0,
      headersSent: false,
      destroyed: false,
      writableEnded: false,
      body: '',
      writeHead(status) { this.statusCode = status; this.headersSent = true; },
      end(chunk = '') { this.body += chunk; this.writableEnded = true; },
      destroy() { this.destroyed = true; }
    };
    return res;
  };
  const deps = {
    token: 'secret-token',
    listModels: async (force) => { calls.push(force); return ['gemini-3.8-flash-high']; },
    modelSettings: { get: () => ({}) },
    modelInfo: () => ({ display_name: 'Gemini 3.8 Flash' }),
    modelDiscovery: () => ({ discoveredAt: null, stale: false, error: null }),
    requestLog: {
      streamCsv: async (res) => {
        res.writeHead(200);
        throw new Error('disk read interrupted');
      }
    },
    accountPool: { status: () => [] }
  };

  for (const [query, expected] of [['', false], ['?force=1', true]]) {
    const res = makeRes();
    const requestUrl = new URL(`http://127.0.0.1/_admin/v1/models${query}`);
    await handleAdminRequest({
      req: { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-agy-admin-token': 'secret-token' } },
      res,
      route: '/_admin/v1/models',
      requestUrl,
      deps
    });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.at(-1), expected);
  }

  // Mid-stream failure after headersSent must not throw ERR_HTTP_HEADERS_SENT.
  const csvRes = makeRes();
  await handleAdminRequest({
    req: { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-agy-admin-token': 'secret-token' } },
    res: csvRes,
    route: '/_admin/v1/logs/requests/export',
    requestUrl: new URL('http://127.0.0.1/_admin/v1/logs/requests/export'),
    deps
  });
  assert.equal(csvRes.destroyed, true);
});

test('multi-key gateway exempts CORS preflight and public file content while populating request log observability fields', async (t) => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-opt-e2e-'));
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

  const script = `
    const http = require('node:http');
    const fs = require('node:fs');
    const path = require('node:path');
    const assert = require('node:assert/strict');
    process.env.ANTIGRAVITY_GATEWAY_CONFIG_DIR = ${JSON.stringify(configDir)};
    process.env.ANTIGRAVITY_GATEWAY_TRANSPORT = 'agy';
    process.env.ANTIGRAVITY_CLI_PATH = process.execPath;
    process.env.ANTIGRAVITY_CLI_PREFIX_ARGS = JSON.stringify([path.resolve('tests/fixtures/fake-agy.js')]);
    process.env.AGY_MULTI_KEY = '1';
    process.env.AGY_KEY_PEPPER = 'test-pepper-1234567890';
    process.env.ANTIGRAVITY_GATEWAY_CORS_ORIGIN = 'https://app.example';
    delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
    const { KeyStore } = require('./src/key-store');
    const ks = new KeyStore({ configDir: process.env.ANTIGRAVITY_GATEWAY_CONFIG_DIR, pepper: process.env.AGY_KEY_PEPPER, multiKey: true });
    const created = ks.create({ name: 'obs-test' });
    ks.stop();
    const { createServer } = require('./antigravity-gateway');
    (async () => {
      const server = createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = 'http://127.0.0.1:' + server.address().port;
      try {
        // 1. CORS OPTIONS preflight on /v1/chat/completions succeeds without auth header.
        const preflight = await fetch(base + '/v1/chat/completions', {
          method: 'OPTIONS',
          headers: { origin: 'https://app.example' }
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example');

        // 2. Public file content route bypasses multi-key auth (404 missing file, not 401).
        const missingFile = await fetch(base + '/v1/files/file_' + 'a'.repeat(32) + '/content');
        assert.equal(missingFile.status, 404);

        // 3. Regular /v1/models still requires auth in multi-key mode.
        const unauthModels = await fetch(base + '/v1/models');
        assert.equal(unauthModels.status, 401);

        // 4. Streaming chat request populates stream, bytes, and model in request logs.
        const chatRes = await fetch(base + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + created.secret
          },
          body: JSON.stringify({
            model: 'gemini-test-high',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }]
          })
        });
        assert.equal(chatRes.status, 200);
        await chatRes.text();
        await new Promise((r) => setTimeout(r, 350));

        const logDir = path.join(process.env.ANTIGRAVITY_GATEWAY_CONFIG_DIR, 'logs', 'requests');
        const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
        assert.ok(files.length >= 1);
        const rows = fs.readFileSync(path.join(logDir, files[0]), 'utf8').trim().split('\\n').map((line) => JSON.parse(line));
        const chatRow = rows.find((row) => row.model === 'gemini-test-high');
        assert.ok(chatRow, 'expected chat request log entry');
        assert.equal(chatRow.stream, true);
        assert.ok(chatRow.bytes > 0);
        assert.equal(chatRow.status, 200);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    })().catch((err) => { console.error(err); process.exit(1); });
  `;

  execFileSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe'
  });
});
