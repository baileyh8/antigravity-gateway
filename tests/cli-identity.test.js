'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'src', 'direct-provider.js');
const testStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-identity-'));
for (const key of ['ANTIGRAVITY_CLI_VERSION', 'ANTIGRAVITY_CLI_CHANGELIST', 'ANTIGRAVITY_DIRECT_USER_AGENT']) delete process.env[key];
test.after(() => fs.rmSync(testStateDir, { recursive: true, force: true }));

// The identity is resolved at module load time, so each environment variant
// runs in its own Node process instead of mutating shared module state.
function loadUserAgent(extraEnv = {}) {
  const env = { ...process.env, ANTIGRAVITY_GATEWAY_CONFIG_DIR: testStateDir };
  for (const key of ['ANTIGRAVITY_CLI_VERSION', 'ANTIGRAVITY_CLI_CHANGELIST', 'ANTIGRAVITY_DIRECT_USER_AGENT']) delete env[key];
  Object.assign(env, extraEnv);
  const script = `
    const { DirectAntigravityProvider } = require(${JSON.stringify(MODULE)});
    const provider = new DirectAntigravityProvider({ localAuth: null, accessToken: 'test', projectId: 'project', models: [] });
    process.stdout.write(provider.userAgent);
  `;
  return execFileSync(process.execPath, ['-e', script], { cwd: ROOT, env, encoding: 'utf8' });
}

test('client identity defaults to the build whose transport we match', () => {
  const ua = loadUserAgent();
  // The native transport is Go 1.27.2 without boringcrypto. The official 1.5.1
  // binary is Go 1.28 RC with boringcrypto and therefore a different
  // ClientHello, so the default identity stays on the version we actually
  // resemble until those binaries are rebuilt.
  assert.equal(ua, `antigravity/cli/1.4.2 (aidev_client; os_type=${process.platform}; arch=${process.arch}; cl=1001591392; auth_method=consumer)`);
  assert.doesNotMatch(ua, /1\.5\.1|1014269460/);
});

test('version and changelist stay configurable as a pair', () => {
  const ua = loadUserAgent({ ANTIGRAVITY_CLI_VERSION: '1.6.0', ANTIGRAVITY_CLI_CHANGELIST: '1099999999' });
  assert.match(ua, /^antigravity\/cli\/1\.6\.0 /);
  assert.match(ua, /cl=1099999999;/);
  assert.doesNotMatch(ua, /1014269460/);
});

test('an explicitly configured user agent still takes precedence', () => {
  assert.equal(loadUserAgent({ ANTIGRAVITY_DIRECT_USER_AGENT: 'custom/agent' }), 'custom/agent');
});

test('cloud code requests carry the configured identity', async () => {
  const { DirectAntigravityProvider } = require('../src/direct-provider');
  const seen = [];
  const provider = new DirectAntigravityProvider({
    localAuth: null, accessToken: 'token', projectId: 'project-1', models: [],
    fetchImpl: async (url, options) => {
      seen.push({ url, userAgent: options.headers['user-agent'] });
      return new Response('{"models":{}}', { status: 200 });
    }
  });
  await provider.probeAuthentication();
  assert.ok(seen.length >= 1);
  assert.ok(seen.every(({ url }) => url.endsWith('/v1internal:fetchAvailableModels')));
  assert.ok(seen.every(({ userAgent }) => /^antigravity\/cli\/1\.4\.2 .*cl=1001591392; auth_method=consumer\)$/.test(userAgent)));
});

