'use strict';

function registerModelRoutes(app, ctx) {
  const { auditWrite, fail, gateway, gatewayFail, requireAdmin, requireUser } = ctx;

  app.get('/admin/api/catalogs', async (req, reply) => {
    if (!requireUser(req, reply)) return fail(reply, 401, 'unauthorized', '请先登录。');
    try { return { ok: true, data: await gateway.adminGet('/_admin/v1/catalogs') }; } catch (error) { return gatewayFail(reply, error); }
  });

  app.post('/admin/api/models/:id/test', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
    const started = Date.now();
    try {
      const result = await gateway.adminRequest('POST', `/_admin/v1/models/${encodeURIComponent(req.params.id)}/test`, undefined, { timeout: 30000 });
      auditWrite(req, user, 'model.test', req.params.id, started);
      return { ok: true, data: result };
    } catch (error) {
      auditWrite(req, user, 'model.test', req.params.id, started, 'failed');
      return gatewayFail(reply, error);
    }
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
}

module.exports = { registerModelRoutes };
