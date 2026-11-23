'use strict';

function registerProxyRoutes(app, ctx) {
  const { auditWrite, fail, gateway, gatewayFail, requireAdmin, requireUser } = ctx;

  app.get('/admin/api/proxies', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return fail(reply, 401, 'unauthorized', '请先登录。');
    try {
      return { ok: true, data: await gateway.adminGet('/_admin/v1/proxies') };
    } catch (error) {
      return gatewayFail(reply, error);
    }
  });

  app.post('/admin/api/proxies', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
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
}

module.exports = { registerProxyRoutes };
