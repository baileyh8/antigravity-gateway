'use strict';

function providerQuery(provider) {
  const value = String(provider || '').trim();
  return value ? `?provider=${encodeURIComponent(value)}` : '';
}

function registerAccountRoutes(app, ctx) {
  const { auditWrite, fail, gateway, gatewayFail, notes, requireAdmin, requireUser } = ctx;

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
    const id = String(req.params.id || '');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const provider = String(body.provider || req.query?.provider || '');
    const started = Date.now();
    try {
      const data = await gateway.adminGet('/_admin/v1/accounts');
      const account = (data.items || []).find((item) => item.id === id && (!provider || item.providerType === provider));
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

  app.post('/admin/api/accounts/oauth/start', async (req, reply) => {
    const user = requireAdmin(req, reply);
    if (!user) return;
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
}

module.exports = { registerAccountRoutes };
