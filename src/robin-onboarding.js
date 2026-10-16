'use strict';
const crypto = require('node:crypto');
const { RobinOAuthFlow } = require('./robin-oauth-flow');
const { bindingKey } = require('./robin-proxy');
function error(message, status = 400) { return Object.assign(new Error(message), { status, code: 'robin_onboarding_error' }); }
class RobinOnboarding {
  constructor({ manager, store, pool, flowFactory = fetchImpl => new RobinOAuthFlow({ fetchImpl }) }) {
    this.manager = manager; this.store = store; this.pool = pool; this.flowFactory = flowFactory; this.current = null;
  }
  status() {
    const r = this.current;
    if (!r) return { state: 'idle' };
    if (r.expiresAt < Date.now() && !['starting', 'waiting', 'checking'].includes(r.state)) { this.current = null; return { state: 'idle' }; }
    return { id: r.id, state: r.state, proxyId: r.proxyId, expiresAt: r.expiresAt,
      ...(r.state === 'waiting' ? { url: r.url } : {}), message: r.message || '', models: r.models || [] };
  }
  async start(proxyId) {
    if (this.current && ['starting', 'waiting', 'checking'].includes(this.current.state)) throw error('已有授权正在进行，请继续或取消。', 409);
    const proxy = this.manager.state.proxies.find(p => p.id === proxyId);
    if (!proxy) throw error('请先选择有效出口代理。');
    const r = { id: crypto.randomUUID(), state: 'starting', proxyId, expiresAt: Date.now() + 5 * 60_000, controller: new AbortController() };
    this.current = r;
    // Lock the selected proxy through authorization and binding, not only each HTTP request.
    this.manager.active.set(proxy.id, (this.manager.active.get(proxy.id) || 0) + 1);
    const flow = this.flowFactory((input, init) => this.manager.via(proxy, input, init)); r.flow = flow;
    let ready;
    const prepared = new Promise(resolve => { ready = resolve; });
    r.done = (async () => {
      try {
        const account = await flow.start({ signal: r.controller.signal, openBrowser: false, onReady: ({ url }) => {
          if (r.controller.signal.aborted) return;
          r.url = url; r.state = 'waiting'; ready();
        } });
        r.controller.signal.throwIfAborted();
        r.state = 'checking'; r.url = '';
        // Refuse overwriting or rebinding an existing identity during account addition.
        const existing = this.store.list().find(a => (account.subjectId && a.subjectId === account.subjectId) || a.email === account.email);
        if (existing) throw error('该账号已存在，请在账号列表管理，无需重复添加。', 409);
        const saved = this.store.save(account); r.saved = true;
        this.manager.bind(bindingKey(saved.id), proxyId);
        this.pool.reload();
        try {
          const signal = AbortSignal.any([r.controller.signal, AbortSignal.timeout(30_000)]);
          await this.pool.listModels(signal, { force: true });
          await this.pool.refreshQuota?.(saved.id, { signal });
          r.models = (this.pool.status().find(a => a.id === saved.id)?.models || []).map(m => typeof m === 'string' ? m : m.id).filter(Boolean);
          r.state = 'complete';
          r.message = r.models.length ? '账号已保存并绑定出口，模型已就绪。' : '账号已保存并绑定出口，尚未发现 Argon 权限。可稍后在账号列表重新检测。';
        } catch {
          r.state = 'complete'; r.message = '账号已保存并绑定出口，能力或额度检查暂未完成。可在账号列表重新检测。';
        }
      } catch {
        r.state = r.controller.signal.aborted ? 'cancelled' : 'failed';
        r.message = r.saved ? '账号已保存，但后续配置未完成，请在账号列表检查代理绑定。' : r.controller.signal.aborted ? '授权已取消或超时，未添加账号。' : '授权未完成：可能已存在该账号、回调已过期或授权服务不可达。请检查后重试。';
      } finally {
        r.url = ''; this.manager.active.set(proxy.id, Math.max(0, (this.manager.active.get(proxy.id) || 1) - 1)); ready();
      }
    })();
    await prepared; return this.status();
  }
  submit(id, value) {
    const r = this.current;
    if (!r || id !== r.id || r.state !== 'waiting') throw error('授权已过期或不匹配，请重新开始。', 409);
    let callback, expected;
    try { callback = new URL(String(value)); expected = new URL(r.url); } catch { throw error('请粘贴地址栏中的完整回调链接。'); }
    const redirect = new URL(expected.searchParams.get('redirect_uri'));
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.username || callback.password
      || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== expected.searchParams.get('state')
      || callback.searchParams.getAll('code').length !== 1 || !callback.searchParams.get('code') || callback.searchParams.has('error')) {
      throw error('回调链接不属于当前授权，或用户未同意授权。请使用本次打开的页面。');
    }
    r.flow.submit(callback.href); r.state = 'checking'; r.url = ''; return this.status();
  }
  cancel(id) {
    const r = this.current;
    if (!r || r.id !== id) throw error('授权已过期。', 409);
    if (r.saved) throw error('账号已保存，请在账号列表管理。', 409);
    r.controller.abort(); r.url = ''; r.state = 'cancelled'; return this.status();
  }
  stop() { this.current?.controller.abort(); return this.current?.done; }
}
module.exports = { RobinOnboarding };
