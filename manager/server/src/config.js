'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function bool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

const root = path.resolve(__dirname, '..');
const basePath = '/admin';
const origin = String(process.env.AGY_MANAGER_ORIGIN || 'http://127.0.0.1:9898').replace(/\/$/, '');
const extraOrigins = String(process.env.AGY_MANAGER_EXTRA_ORIGINS || '')
  .split(',')
  .map((item) => item.trim().replace(/\/$/, ''))
  .filter(Boolean);

const sessionSecretFile = process.env.AGY_SESSION_SECRET_FILE || '/etc/agy-manager/session-secret';
let sessionSecret = String(process.env.AGY_SESSION_SECRET || '').trim() || readText(sessionSecretFile);
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`缺少会话密钥：请创建 ${sessionSecretFile}（32 字节随机）或设置 AGY_SESSION_SECRET。`);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[agy-manager] 未找到会话密钥，使用临时密钥；重启后现有登录会失效。');
}
if (process.env.NODE_ENV === 'production' && sessionSecret.length < 32) {
  throw new Error('会话密钥至少需要 32 个字符；请重新生成 /etc/agy-manager/session-secret。');
}

const config = {
  root,
  version: require('../package.json').version,
  host: process.env.AGY_MANAGER_HOST || '127.0.0.1',
  port: Number(process.env.AGY_MANAGER_PORT || 9898),
  dataDir: path.resolve(process.env.AGY_MANAGER_DATA_DIR || path.join(root, 'data')),
  gatewayUrl: String(process.env.AGY_GATEWAY_URL || 'http://127.0.0.1:9897').replace(/\/$/, ''),
  adminTokenFile: process.env.AGY_ADMIN_TOKEN_FILE || '/etc/agy-manager/admin-token',
  adminToken: String(process.env.AGY_ADMIN_TOKEN || '').trim(),
  sessionSecret,
  sessionSecretFile,
  origin,
  allowedOrigins: [...new Set([origin, 'http://127.0.0.1:9898', 'http://localhost:9898', 'http://127.0.0.1:3000', 'http://localhost:3000', ...extraOrigins])],
  allowNoOrigin: bool('AGY_MANAGER_ALLOW_NO_ORIGIN', false),
  basePath,
  cookieName: 'agy_manager_session',
  cookieSecure: bool('AGY_MANAGER_COOKIE_SECURE', true),
  serveStatic: bool('AGY_MANAGER_SERVE_STATIC', false),
  staticDir: path.resolve(process.env.AGY_MANAGER_STATIC_DIR || path.join(root, '..', 'web', 'out')),
  adminUsername: process.env.AGY_ADMIN_USERNAME || 'bailey',
  adminPassword: process.env.AGY_ADMIN_PASSWORD || '',
  sessionIdleMs: 12 * 60 * 60 * 1000,
  sessionMaxMs: 7 * 24 * 60 * 60 * 1000,
  sessionRefreshMs: 10 * 60 * 1000
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('AGY_MANAGER_PORT 必须是 1-65535 的整数。');
}

module.exports = config;
