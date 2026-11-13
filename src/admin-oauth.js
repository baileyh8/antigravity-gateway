'use strict';

const crypto = require('node:crypto');

const { maskEmail } = require('./account-format');

const FLOW_TTL_MS = 10 * 60_000;
const PENDING_TIMEOUT_MS = 6 * 60_000;

function oauthError(message, status = 409, code = 'oauth_flow_error') {
  return Object.assign(new Error(message), { status, code });
}

class AdminOAuth {
  constructor({ flow, flowFactory, accountStore, accountPool, quotaManager, proxyManager, now = () => Date.now() }) {
    this.flowFactory = flowFactory || (() => flow);
    this.accountStore = accountStore;
    this.accountPool = accountPool;
    this.quotaManager = quotaManager;
    this.proxyManager = proxyManager;
    this.now = now;
    this.current = null;
  }

  prune() {
    const current = this.current;
    if (!current) return;
    const age = this.now() - current.startedAt;
    if (['complete', 'failed', 'cancelled'].includes(current.state) && age > FLOW_TTL_MS) this.current = null;
    else if (['starting', 'waiting', 'checking'].includes(current.state) && age > PENDING_TIMEOUT_MS) {
      current.state = 'failed';
      current.error = '授权已超时，请重新发起。';
      current.url = '';
    }
  }

  status(id = '') {
    this.prune();
    const current = this.current;
    if (!current || (id && current.id !== id)) return null;
    return {
      id: current.id,
      state: current.state,
      url: current.state === 'waiting' ? current.url : '',
      proxyId: current.proxyId || '',
      account: current.account || null,
      error: current.error || '',
      startedAt: new Date(current.startedAt).toISOString()
    };
  }

  async start({ proxyId = '' } = {}) {
    this.prune();
    if (this.current && ['starting', 'waiting', 'checking'].includes(this.current.state)) {
      throw oauthError('已有授权正在进行，请继续或取消。', 409, 'oauth_flow_busy');
    }
    const proxy = proxyId ? this.proxyManager?.state?.proxies?.find((item) => item.id === proxyId) : null;
    if (proxyId && !proxy) throw oauthError('选定的出口代理不存在。', 400, 'proxy_not_found');

    const current = {
      id: crypto.randomUUID(),
      state: 'starting',
      startedAt: this.now(),
      url: '',
      proxyId,
      account: null,
      error: ''
    };
    this.current = current;
    const flow = this.flowFactory();
    current.flow = flow;
    let readyResolve;
    const ready = new Promise((resolve) => { readyResolve = resolve; });
    current.done = Promise.resolve().then(() => flow.start({
      onReady: ({ url }) => {
        if (current.state !== 'starting') return;
        current.state = 'waiting';
        current.url = url;
        readyResolve();
      }
    })).then((account) => {
      if (current.state === 'cancelled') return;
      const saved = this.accountStore.save(account, { newGrant: true });
      if (proxyId) this.proxyManager.bind(saved.id, proxyId);
      this.accountPool.reload();
      void this.quotaManager?.refreshAccount?.(saved.id, { force: true, summaryOnly: false })?.catch?.(() => {});
      current.state = 'complete';
      current.account = { id: saved.id, emailMasked: maskEmail(saved.email) };
      current.url = '';
    }).catch((error) => {
      if (current.state === 'cancelled') return;
      current.state = 'failed';
      current.url = '';
      current.error = '授权未完成：回调无效、账号已存在或授权服务不可达。请重新发起。';
      console.error('[agy-manager] account oauth failed:', error?.message || error);
    }).finally(() => {
      readyResolve();
    });
    await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 2000))]);
    return this.status(current.id);
  }

  submit(id, callback) {
    this.prune();
    const current = this.current;
    if (!current || current.id !== id || current.state !== 'waiting') {
      throw oauthError('授权已过期或不匹配，请重新发起。', 409, 'oauth_flow_expired');
    }
    let accepted = false;
    try { accepted = current.flow?.submit(String(callback || '')); } catch { accepted = false; }
    if (!accepted) throw oauthError('回调链接无法提交，请重新发起授权。', 400, 'oauth_callback_invalid');
    current.state = 'checking';
    current.url = '';
    return this.status(id);
  }

  cancel(id) {
    const current = this.current;
    if (!current || current.id !== id) throw oauthError('授权不存在或已结束。', 404, 'oauth_flow_not_found');
    if (current.state === 'complete') throw oauthError('账号已保存，无需取消。', 409, 'oauth_flow_complete');
    current.state = 'cancelled';
    current.url = '';
    try { current.flow?.active?.close?.(); } catch { /* closing the callback server is best effort */ }
    return this.status(id);
  }
}

module.exports = { AdminOAuth };
