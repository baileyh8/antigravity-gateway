'use strict';

const { Readable } = require('node:stream');

function registerLogRoutes(app, ctx) {
  const { auditWrite, fail, gateway, gatewayFail, requireAdmin, requireUser, store } = ctx;

  app.get('/admin/api/usage', async (req, reply) => {
    if (!requireUser(req, reply)) return fail(reply, 401, 'unauthorized', '请先登录。');
    const days = Number(req.query?.days ?? 7);
    const groupBy = String(req.query?.groupBy || 'model');
    const grain = String(req.query?.grain || 'day');
    if (!Number.isInteger(days) || days < 1 || days > 31 || !['model', 'account', 'key'].includes(groupBy) || !['day', 'hour'].includes(grain) || (groupBy === 'key' && grain === 'hour')) {
      return fail(reply, 400, 'invalid_usage_query', '用量范围须为 1–31 天。');
    }
    try { return { ok: true, data: await gateway.getUsage(days, groupBy, grain) }; } catch (error) { return gatewayFail(reply, error); }
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
}

module.exports = { registerLogRoutes };
