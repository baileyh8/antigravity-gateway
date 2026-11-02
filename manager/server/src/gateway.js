'use strict';

const fs = require('node:fs');

const config = require('./config');

class GatewayError extends Error {
  constructor(message, { status = 502, code = 'gateway_error' } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

let tokenCache = { value: '', at: 0 };

function adminToken() {
  if (config.adminToken) return config.adminToken;
  if (Date.now() - tokenCache.at < 10_000) return tokenCache.value;
  let value = '';
  try { value = fs.readFileSync(config.adminTokenFile, 'utf8').trim(); } catch { value = ''; }
  tokenCache = { value, at: Date.now() };
  return value;
}

async function adminRequest(method, pathname, body, { timeout = 5000 } = {}) {
  const token = adminToken();
  if (!token) throw new GatewayError('基座管理接口未启用（缺少管理令牌）。', { status: 503, code: 'admin_api_disabled' });
  const headers = { 'x-agy-admin-token': token, 'x-agy-admin-version': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${config.gatewayUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    throw new GatewayError('无法连接基座管理接口。', { status: 503, code: 'gateway_unreachable' });
  }
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok || !payload?.ok) {
    const code = payload?.error?.code || (response.status === 401 ? 'admin_token_invalid' : 'gateway_error');
    const message = payload?.error?.message || `基座返回 HTTP ${response.status}`;
    throw new GatewayError(message, { status: response.status === 401 ? 503 : response.status, code });
  }
  if (method !== 'GET') {
    cache.delete('overview');
    cache.delete('accounts');
    for (const key of cache.keys()) if (key.startsWith('usage:')) cache.delete(key);
  }
  return payload.data;
}

function adminGet(pathname, options) {
  return adminRequest('GET', pathname, undefined, options);
}

const cache = new Map();
const inflight = new Map();

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const promise = loader()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, promise);
  return promise;
}

function getOverview() {
  return cached('overview', 5000, () => adminGet('/_admin/v1/overview'));
}

function getAccounts() {
  return cached('accounts', 5000, () => adminGet('/_admin/v1/accounts'));
}

function getUsage(days, groupBy, grain = 'day') {
  return cached(`usage:${days}:${groupBy}:${grain}`, 30000, () => adminGet(`/_admin/v1/usage?days=${days}&groupBy=${groupBy}&grain=${grain}`));
}

async function adminStream(pathname) {
  const token = adminToken();
  if (!token) throw new GatewayError('基座管理接口未启用。', { status: 503 });
  const response = await fetch(`${config.gatewayUrl}${pathname}`, { headers: { 'x-agy-admin-token': token }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new GatewayError('日志导出失败，请稍后重试。', { status: response.status });
  return response;
}

async function health() {
  try {
    const data = await adminGet('/_admin/v1/health', { timeout: 1500 });
    return { ok: true, version: data.version, apiVersion: data.apiVersion };
  } catch (error) {
    return { ok: false, code: error.code || 'gateway_unreachable' };
  }
}

module.exports = { GatewayError, adminGet, adminRequest, adminToken, adminStream, getAccounts, getOverview, getUsage, health };
