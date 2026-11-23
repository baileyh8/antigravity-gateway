'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { burnPasswordCheckAsync, hashPasswordAsync, verifyPasswordAsync } = require('../auth');

function registerAuthRoutes(app, ctx) {
  const { auditWrite, clientIp, config, fail, gateway, limiter, publicUser, requireAdmin, requireUser, setSession, store } = ctx;

  app.post('/admin/api/auth/login', async (req, reply) => {
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
    if (!user) await burnPasswordCheckAsync(password);
    const ok = user ? await verifyPasswordAsync(password, user.passwordHash) : false;
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
    const started = Date.now();
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const lockKey = `password:${clientIp(req)}|${user.username}`;
    if (limiter.retryAfter(lockKey)) return fail(reply, 429, 'password_locked', '尝试次数过多，请稍后重试。');
    if (!await verifyPasswordAsync(currentPassword, user.passwordHash)) {
      limiter.fail(lockKey);
      auditWrite(req, user, 'auth.password', user.username, started, 'failed');
      return fail(reply, 400, 'wrong_password', '当前密码不正确。');
    }
    if (newPassword.length < 12 || newPassword.length > 200 || newPassword === currentPassword || !/[a-zA-Z]/.test(newPassword) || !/[^a-zA-Z]/.test(newPassword) || /^(password|qwerty|admin|123456)/i.test(newPassword)) {
      return fail(reply, 400, 'weak_password', '新密码需 12–200 位，包含字母及数字或符号，且不能与当前密码相同。');
    }
    const passwordHash = await hashPasswordAsync(newPassword);
    const updated = store.updateUser(user.username, {
      passwordHash,
      sessionEpoch: (Number(user.sessionEpoch) || 1) + 1,
      passwordChangedAt: new Date().toISOString()
    });
    limiter.clear(lockKey);
    setSession(reply, updated);
    try { fs.rmSync(path.join(config.dataDir, 'initial-admin-password'), { force: true }); } catch { /* password already changed */ }
    auditWrite(req, user, 'auth.password', user.username, started);
    return { ok: true, data: { changed: true } };
  });

  app.get('/admin/api/settings', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
    return {
      ok: true,
      data: {
        user: publicUser(user),
        managerVersion: config.version,
        gateway: await gateway.health(),
        requestLogRetentionDays: 30,
        auditRetentionDays: 180,
        passwordChangedAt: user.passwordChangedAt || null,
        initialPasswordPending: fs.existsSync(path.join(config.dataDir, 'initial-admin-password'))
      }
    };
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
}

module.exports = { registerAuthRoutes };
