'use strict';

function registerKeyRoutes(app, ctx) {
  const { auditWrite, fail, gateway, gatewayFail, requireAdmin, requireUser } = ctx;

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
}

module.exports = { registerKeyRoutes };
