'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const csrf = require('./csrf');
const path = require('node:path');
const Fastify = require('fastify');
const cookie = require('@fastify/cookie');

const config = require('./config');
const store = require('./store');
const { LoginLimiter, burnPasswordCheck, hashPassword, signSession, verifyPassword, verifySession } = require('./auth');
const gateway = require('./gateway');
const notes = require('./notes');
const { serveStatic } = require('./static');

const limiter = new LoginLimiter();
const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 64 * 1024 });

function fail(reply, status, code, message) {
  return reply.code(status).send({ ok: false, error: { code, message } });
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '');
}

function originAllowed(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  if (!origin) return config.allowNoOrigin;
  return config.allowedOrigins.includes(origin);
}

function setSession(reply, user, previous = {}) {
  const now = Date.now();
  const iat = Number(previous.iat) || now;
  const payload = {
    u: user.username,
    r: user.role,
    v: Number(user.sessionEpoch) || 1,
    iat,
    last: now,
    exp: Math.min(iat + config.sessionMaxMs, now + config.sessionMaxMs)
  };
  const token = signSession(payload, config.sessionSecret);
  reply.setCookie(config.cookieName, token, {
    path: config.basePath,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: Math.floor(config.sessionMaxMs / 1000)
  });
}

function requireUser(req, reply) {
  const token = req.cookies?.[config.cookieName];
  const payload = verifySession(token, config.sessionSecret);
  if (!payload || !payload.u || !payload.iat || !payload.exp) return null;
  const now = Date.now();
  if (now > Number(payload.exp) || now - Number(payload.last || 0) > config.sessionIdleMs) return null;
  const user = store.getUser(payload.u);
  if (!user || (Number(user.sessionEpoch) || 1) !== Number(payload.v)) return null;
  if (now - Number(payload.last || 0) > config.sessionRefreshMs) setSession(reply, user, { iat: payload.iat });
  return user;
}

function publicUser(user) {
  return { username: user.username, role: user.role };
}

function requireAdmin(req, reply) {
  const user = requireUser(req, reply);
  if (!user) {
    fail(reply, 401, 'unauthorized', '请先登录。');
    return null;
  }
  if (user.role !== 'admin') {
    fail(reply, 403, 'forbidden', '需要管理员权限。');
    return null;
  }
  return user;
}

function auditWrite(req, user, action, target, started, result = 'ok', detail = '') {
  store.audit({
    actor: user?.username || 'anonymous',
    ip: clientIp(req),
    action,
    target,
    result,
    durationMs: Date.now() - started,
    detail
  });
}

function gatewayFail(reply, error) {
  return fail(reply, error.status || 503, error.code || 'gateway_error', error.message || '基座不可用。');
}

function providerQuery(provider) {
  const value = String(provider || '').trim();
  return value ? `?provider=${encodeURIComponent(value)}` : '';
}

app.register(cookie);
app.addHook('preHandler', async (req, reply) => {
  if (req.url.startsWith('/admin/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
    if (!csrf.valid(req)) return fail(reply, 403, 'csrf_invalid', '会话校验已过期，请重试。');
  }
});
app.get('/admin/api/auth/csrf', async (req, reply) => ({ ok: true, data: { token: csrf.issue(req, reply) } }));

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.method === 'GET' && reply.statusCode === 200 && /^\/admin\/api\/(overview|accounts|keys|usage)(\?|$)/.test(req.url) && typeof payload === 'string') {
    const etag = `W/"${crypto.createHash('sha256').update(payload).digest('base64url')}"`;
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) { reply.code(304); return ''; }
  }

  reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
  return payload;
});

app.post('/admin/api/auth/login', async (req, reply) => {
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || username.length > 64 || !password || password.length > 200) {
    return fail(reply, 400, 'invalid_credentials', '请输入用户名和密码。');
  }
  const key = `${clientIp(req)}|${username.toLowerCase()}`;
  const retryAfter = limiter.retryAfter(key);
  if (retryAfter > 0) {
    reply.header('Retry-After', String(retryAfter));
    return fail(reply, 429, 'login_locked', `尝试次数过多，请在 ${Math.ceil(retryAfter / 60)} 分钟后重试。`);
  }
  const started = Date.now();
  const user = store.getUser(username);
  if (!user) burnPasswordCheck(password);
  const ok = user ? verifyPassword(password, user.passwordHash) : false;
  if (!ok) {
    limiter.fail(key);
    store.audit({
      actor: `unknown:${username}`,
      ip: clientIp(req),
      action: 'auth.login',
      target: username,
      result: 'failed',
      durationMs: Date.now() - started
    });
    return fail(reply, 401, 'invalid_credentials', '用户名或密码不正确。');
  }
  limiter.clear(key);
  store.updateUser(user.username, { lastLoginAt: new Date().toISOString() });
  setSession(reply, user);
  store.audit({ actor: user.username, ip: clientIp(req), action: 'auth.login', target: user.username, result: 'ok', durationMs: Date.now() - started });
  return { ok: true, data: { user: publicUser(user) } };
});

app.post('/admin/api/auth/logout', async (req, reply) => {
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  store.updateUser(user.username, { sessionEpoch: (Number(user.sessionEpoch) || 1) + 1 });
  reply.clearCookie(config.cookieName, { path: config.basePath });
  store.audit({ actor: user.username, ip: clientIp(req), action: 'auth.logout', target: user.username, result: 'ok' });
  return { ok: true, data: { loggedOut: true } };
});

app.get('/admin/api/auth/me', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  return { ok: true, data: { user: publicUser(user) } };
});

app.post('/admin/api/auth/password', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const started = Date.now();
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const lockKey = `password:${clientIp(req)}|${user.username}`;
  if (limiter.retryAfter(lockKey)) return fail(reply, 429, 'password_locked', '尝试次数过多，请稍后重试。');
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    limiter.fail(lockKey);
    auditWrite(req, user, 'auth.password', user.username, started, 'failed');
    return fail(reply, 400, 'wrong_password', '当前密码不正确。');
  }
  if (newPassword.length < 12 || newPassword.length > 200 || newPassword === currentPassword || !/[a-zA-Z]/.test(newPassword) || !/[^a-zA-Z]/.test(newPassword) || /^(password|qwerty|admin|123456)/i.test(newPassword)) {
    return fail(reply, 400, 'weak_password', '新密码需 12–200 位，包含字母及数字或符号，且不能与当前密码相同。');
  }
  const updated = store.updateUser(user.username, { passwordHash: hashPassword(newPassword), sessionEpoch: (Number(user.sessionEpoch) || 1) + 1, passwordChangedAt: new Date().toISOString() });
  limiter.clear(lockKey);
  setSession(reply, updated);
  try { fs.rmSync(path.join(config.dataDir, 'initial-admin-password'), { force: true }); } catch { /* password already changed */ }
  auditWrite(req, user, 'auth.password', user.username, started);
  return { ok: true, data: { changed: true } };
});

app.get('/admin/api/settings', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  return { ok: true, data: { user: publicUser(user), managerVersion: config.version, gateway: await gateway.health(), requestLogRetentionDays: 30, auditRetentionDays: 180, passwordChangedAt: user.passwordChangedAt || null, initialPasswordPending: fs.existsSync(path.join(config.dataDir, 'initial-admin-password')) } };
});

app.get('/admin/api/usage', async (req, reply) => {
  if (!requireUser(req, reply)) return fail(reply, 401, 'unauthorized', '请先登录。');
  const days = Number(req.query?.days ?? 7);
  const groupBy = String(req.query?.groupBy || 'model');
  const grain = String(req.query?.grain || 'day');
  if (!Number.isInteger(days) || days < 1 || days > 31 || !['model', 'account', 'key'].includes(groupBy) || !['day', 'hour'].includes(grain) || (groupBy === 'key' && grain === 'hour')) return fail(reply, 400, 'invalid_usage_query', '用量范围须为 1–31 天。');
  try { return { ok: true, data: await gateway.getUsage(days, groupBy, grain) }; } catch (error) { return gatewayFail(reply, error); }
});

app.get('/admin/api/catalogs', async (req, reply) => {
  if (!requireUser(req, reply)) return fail(reply, 401, 'unauthorized', '请先登录。');
  try { return { ok: true, data: await gateway.adminGet('/_admin/v1/catalogs') }; } catch (error) { return gatewayFail(reply, error); }
});

app.post('/admin/api/models/:id/test', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', `/_admin/v1/models/${encodeURIComponent(req.params.id)}/test`, undefined, { timeout: 30000 });
    auditWrite(req, user, 'model.test', req.params.id, started);
    return { ok: true, data: result };
  } catch (error) { auditWrite(req, user, 'model.test', req.params.id, started, 'failed'); return gatewayFail(reply, error); }
});

app.get('/admin/api/health', async () => {
  const gatewayHealth = await gateway.health();
  return {
    ok: true,
    data: {
      service: 'agy-manager',
      version: config.version,
      gateway: gatewayHealth,
      staticReady: fs.existsSync(path.join(config.staticDir, 'index.html'))
    }
  };
});

app.get('/admin/api/overview', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  try {
    return { ok: true, data: await gateway.getOverview() };
  } catch (error) {
    return fail(reply, error.status || 503, error.code || 'gateway_unavailable', error.message || '基座不可用。');
  }
});

app.get('/admin/api/accounts', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  try {
    const data = await gateway.getAccounts();
    const noteMap = notes.all();
    return {
      ok: true,
      data: {
        ...data,
        items: (data.items || []).map((account) => ({
          ...account,
          note: noteMap[account.id]?.text || '',
          noteUpdatedAt: noteMap[account.id]?.updatedAt || ''
        }))
      }
    };
  } catch (error) {
    return gatewayFail(reply, error);
  }
});

app.patch('/admin/api/accounts/:id', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const hasEnabled = typeof body.enabled === 'boolean';
  const hasWeight = body.weight !== undefined;
  const hasNote = body.note !== undefined;
  if (!hasEnabled && !hasWeight && !hasNote) return fail(reply, 400, 'empty_update', '没有需要更新的字段。');
  if (hasNote && (typeof body.note !== 'string' || body.note.trim().length > 500)) {
    return fail(reply, 400, 'invalid_note', '备注必须是 0-500 个字符的文本。');
  }
  const started = Date.now();
  try {
    let result = null;
    if (hasEnabled || hasWeight) {
      result = await gateway.adminRequest('PATCH', `/_admin/v1/accounts/${encodeURIComponent(id)}`, {
        enabled: hasEnabled ? body.enabled : undefined,
        weight: hasWeight ? body.weight : undefined,
        provider: body.provider
      });
    }
    if (hasNote) notes.set(id, body.note, user.username);
    auditWrite(req, user, 'account.update', id, started, 'ok', JSON.stringify({
      enabled: hasEnabled ? body.enabled : undefined,
      weight: hasWeight ? body.weight : undefined,
      note: hasNote ? (String(body.note || '').trim() ? 'set' : 'cleared') : undefined
    }));
    return { ok: true, data: { account: result?.account || null } };
  } catch (error) {
    auditWrite(req, user, 'account.update', id, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/accounts/:id/recheck', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const provider = String(req.body?.provider || req.query?.provider || '');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', `/_admin/v1/accounts/${encodeURIComponent(id)}/recheck${providerQuery(provider)}`);
    auditWrite(req, user, 'account.recheck', id, started, 'ok', JSON.stringify({ provider }));
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'account.recheck', id, started, 'failed', JSON.stringify({ provider }));
    return gatewayFail(reply, error);
  }
});

app.delete('/admin/api/accounts/:id', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const provider = String(body.provider || req.query?.provider || '');
  const started = Date.now();
  try {
    const data = await gateway.adminGet('/_admin/v1/accounts');
    const account = (data.items || []).find((item) => item.id === id);
    if (!account) return fail(reply, 404, 'account_not_found', '账号不存在或已被删除。');
    const confirm = String(body.confirm || '').trim();
    if (confirm !== account.emailMasked && confirm !== account.id) {
      return fail(reply, 400, 'confirm_mismatch', '请输入账号的脱敏邮箱或账号 ID 确认删除。');
    }
    auditWrite(req, user, 'account.delete', id, started, 'pending', JSON.stringify({ provider }));
    const result = await gateway.adminRequest('DELETE', `/_admin/v1/accounts/${encodeURIComponent(id)}${providerQuery(provider)}`);
    notes.remove(id);
    auditWrite(req, user, 'account.delete', id, started, 'ok', JSON.stringify({ provider }));
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'account.delete', id, started, 'failed', JSON.stringify({ provider }));
    return gatewayFail(reply, error);
  }
});

app.put('/admin/api/accounts/:id/proxy', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('PUT', `/_admin/v1/accounts/${encodeURIComponent(id)}/proxy`, {
      proxyId: body.proxyId === null ? null : String(body.proxyId || ''),
      provider: body.provider
    });
    auditWrite(req, user, 'account.proxy', id, started, 'ok', JSON.stringify({ proxyId: body.proxyId || 'none' }));
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'account.proxy', id, started, 'failed', JSON.stringify({ proxyId: body.proxyId || 'none' }));
    return gatewayFail(reply, error);
  }
});

app.get('/admin/api/proxies', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  try {
    return { ok: true, data: await gateway.adminGet('/_admin/v1/proxies') };
  } catch (error) {
    return gatewayFail(reply, error);
  }
});

app.get('/admin/api/keys', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  try {
    return { ok: true, data: await gateway.adminGet('/_admin/v1/keys') };
  } catch (error) {
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/keys', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const started = Date.now();
  try {
    auditWrite(req, user, 'key.create', String(body.name || ''), started, 'pending');
    const result = await gateway.adminRequest('POST', '/_admin/v1/keys', { ...body, actor: user.username });
    auditWrite(req, user, 'key.create', result?.key?.prefix || '', started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'key.create', String(body.name || ''), started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.patch('/admin/api/keys/:id', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('PATCH', `/_admin/v1/keys/${encodeURIComponent(id)}`, body);
    auditWrite(req, user, 'key.update', id, started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'key.update', id, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/keys/:id/roll', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', `/_admin/v1/keys/${encodeURIComponent(id)}/roll`);
    auditWrite(req, user, 'key.roll', id, started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'key.roll', id, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/keys/:id/reset-usage', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', `/_admin/v1/keys/${encodeURIComponent(id)}/reset-usage`);
    auditWrite(req, user, 'key.reset_usage', id, started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'key.reset_usage', id, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.delete('/admin/api/keys/:id', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const started = Date.now();
  try {
    auditWrite(req, user, 'key.delete', id, started, 'pending');
    const result = await gateway.adminRequest('DELETE', `/_admin/v1/keys/${encodeURIComponent(id)}`);
    auditWrite(req, user, 'key.delete', id, started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'key.delete', id, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.get('/admin/api/logs/requests/export', async (req, reply) => {
  if (!requireUser(req, reply)) return fail(reply, 401, 'unauthorized', '请先登录。');
  const query = new URLSearchParams(req.query || {}).toString();
  try {
    const response = await gateway.adminStream(`/_admin/v1/logs/requests/export?${query}`);
    reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="agy-request-logs.csv"');
    reply.header('X-Agy-Export-Rows', response.headers.get('x-agy-export-rows') || '0');
    reply.header('X-Agy-Export-Truncated', response.headers.get('x-agy-export-truncated') || 'false');
    return reply.send(Readable.fromWeb(response.body));
  } catch (error) { return gatewayFail(reply, error); }
});

app.get('/admin/api/logs/requests', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  const query = new URLSearchParams(req.query || {}).toString();
  try {
    return { ok: true, data: await gateway.adminGet(`/_admin/v1/logs/requests${query ? `?${query}` : ''}`) };
  } catch (error) {
    return gatewayFail(reply, error);
  }
});

app.delete('/admin/api/logs/requests', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const started = Date.now();
  try {
    auditWrite(req, user, 'logs.clear', String(body.before || ''), started, 'pending');
    const result = await gateway.adminRequest('DELETE', '/_admin/v1/logs/requests', { before: body.before });
    auditWrite(req, user, 'logs.clear', String(body.before || ''), started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'logs.clear', String(body.before || ''), started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.get('/admin/api/logs/diagnostics', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  const query = new URLSearchParams(req.query || {}).toString();
  try {
    return { ok: true, data: await gateway.adminGet(`/_admin/v1/logs/diagnostics${query ? `?${query}` : ''}`) };
  } catch (error) {
    return gatewayFail(reply, error);
  }
});

app.get('/admin/api/audit', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  return {
    ok: true,
    data: store.readAudit({
      days: Number(req.query?.days) || 30,
      action: String(req.query?.action || ''),
      actor: String(req.query?.actor || ''),
      page: Number(req.query?.page) || 1,
      size: Number(req.query?.size) || 20
    })
  };
});

app.get('/admin/api/models', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
  const force = req.query?.force === '1' ? '?force=1' : '';
  try {
    return { ok: true, data: await gateway.adminGet(`/_admin/v1/models${force}`) };
  } catch (error) {
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/models/discover', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', '/_admin/v1/models/discover', undefined, { timeout: 30_000 });
    auditWrite(req, user, 'models.discover', '', started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'models.discover', '', started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.patch('/admin/api/models/:id', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('PATCH', `/_admin/v1/models/${encodeURIComponent(id)}`, body);
    auditWrite(req, user, 'model.update', id, started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'model.update', id, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/catalogs/sync', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', '/_admin/v1/catalogs/sync', undefined, { timeout: 30_000 });
    auditWrite(req, user, 'models.sync', '', started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'models.sync', '', started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/proxies', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', '/_admin/v1/proxies', {
      id: body.id,
      name: body.name,
      url: body.url
    });
    auditWrite(req, user, 'proxy.save', String(body.id || body.name || ''), started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'proxy.save', String(body.id || body.name || ''), started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/proxies/:id/check', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', `/_admin/v1/proxies/${encodeURIComponent(id)}/check`);
    auditWrite(req, user, 'proxy.check', id, started, result.ok ? 'ok' : 'failed');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'proxy.check', id, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.delete('/admin/api/proxies/:id', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const id = String(req.params.id || '');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('DELETE', `/_admin/v1/proxies/${encodeURIComponent(id)}`);
    auditWrite(req, user, 'proxy.delete', id, started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'proxy.delete', id, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/accounts/oauth/start', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const provider = String(body.provider || 'cloudcode');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', '/_admin/v1/accounts/oauth/start', {
      provider,
      proxyId: String(body.proxyId || '')
    }, { timeout: 10_000 });
    auditWrite(req, user, 'account.oauth.start', provider, started, 'ok', JSON.stringify({ proxyId: body.proxyId || '' }));
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'account.oauth.start', provider, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/accounts/oauth/callback', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const provider = String(body.provider || 'cloudcode');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', '/_admin/v1/accounts/oauth/callback', {
      provider,
      id: String(body.id || ''),
      callback: String(body.callback || '')
    }, { timeout: 10_000 });
    auditWrite(req, user, 'account.oauth.callback', provider, started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'account.oauth.callback', provider, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.get('/admin/api/accounts/oauth/:id', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  const provider = String(req.query?.provider || 'cloudcode');
  try {
    return { ok: true, data: await gateway.adminGet(`/_admin/v1/accounts/oauth/${encodeURIComponent(req.params.id)}${providerQuery(provider)}`) };
  } catch (error) {
    return gatewayFail(reply, error);
  }
});

app.post('/admin/api/accounts/oauth/:id/cancel', async (req, reply) => {
  const user = requireAdmin(req, reply);
  if (!user) return;
  if (!originAllowed(req)) return fail(reply, 403, 'origin_not_allowed', '请求来源未获授权。');
  const provider = String(req.body?.provider || req.query?.provider || 'cloudcode');
  const started = Date.now();
  try {
    const result = await gateway.adminRequest('POST', `/_admin/v1/accounts/oauth/${encodeURIComponent(req.params.id)}/cancel${providerQuery(provider)}`);
    auditWrite(req, user, 'account.oauth.cancel', provider, started, 'ok');
    return { ok: true, data: result };
  } catch (error) {
    auditWrite(req, user, 'account.oauth.cancel', provider, started, 'failed');
    return gatewayFail(reply, error);
  }
});

app.get('/admin', async (req, reply) => reply.redirect('/admin/', 302));

app.get('/admin/*', async (req, reply) => {
  if (req.url.startsWith('/admin/api/')) return fail(reply, 404, 'not_found', '接口不存在。');
  return serveStatic(req, reply, config);
});

app.setErrorHandler((error, req, reply) => {
  if (error.statusCode && error.statusCode < 500) {
    return fail(reply, error.statusCode, 'bad_request', error.message || '请求无效。');
  }
  console.error('[agy-manager] request failed:', error?.message || error);
  return fail(reply, 500, 'internal_error', '服务内部错误。');
});

async function main() {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const bootstrap = store.bootstrapAdmin();
  await store.pruneAudit();
  const auditPruneTimer = setInterval(() => store.pruneAudit().catch(() => {}), 86400000);
  auditPruneTimer.unref();
  app.addHook('onClose', async () => clearInterval(auditPruneTimer));
  if (bootstrap.created) {
    console.log(`[agy-manager] 已创建管理员 ${bootstrap.username}`);
    if (bootstrap.passwordFile) console.log(`[agy-manager] 初始密码已写入 ${bootstrap.passwordFile}（0600），登录后请改密并删除该文件。`);
  }
  await app.listen({ host: config.host, port: config.port });
  console.log(`[agy-manager] listening on http://${config.host}:${config.port}${config.basePath}/`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}

if (require.main === module) main().catch((error) => {
  console.error('[agy-manager] 启动失败:', error.message);
  process.exit(1);
});

module.exports = { app };
