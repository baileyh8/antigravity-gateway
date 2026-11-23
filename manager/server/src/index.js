'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const cookie = require('@fastify/cookie');

const csrf = require('./csrf');
const config = require('./config');
const store = require('./store');
const { LoginLimiter, signSession, verifySession } = require('./auth');
const gateway = require('./gateway');
const notes = require('./notes');
const { serveStatic } = require('./static');
const { registerAuthRoutes } = require('./routes/auth');
const { registerAccountRoutes } = require('./routes/accounts');
const { registerProxyRoutes } = require('./routes/proxies');
const { registerKeyRoutes } = require('./routes/keys');
const { registerModelRoutes } = require('./routes/models');
const { registerLogRoutes } = require('./routes/logs');

const limiter = new LoginLimiter();
const limiterPruneTimer = setInterval(() => limiter.prune(), 15 * 60 * 1000);
limiterPruneTimer.unref();

const app = Fastify({ logger: false, trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });

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

app.addHook('onClose', async () => {
  clearInterval(limiterPruneTimer);
  await store.flushAudit();
});

const routeContext = {
  auditWrite,
  clientIp,
  config,
  fail,
  gateway,
  gatewayFail,
  limiter,
  notes,
  publicUser,
  requireAdmin,
  requireUser,
  setSession,
  store
};

registerAuthRoutes(app, routeContext);
registerAccountRoutes(app, routeContext);
registerProxyRoutes(app, routeContext);
registerKeyRoutes(app, routeContext);
registerModelRoutes(app, routeContext);
registerLogRoutes(app, routeContext);

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
