'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { ProxySnapshot } from '@/lib/types';

export function ProxyPanel({
  snapshot,
  onChanged
}: {
  snapshot: ProxySnapshot | null;
  onChanged: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function run(key: string, action: () => Promise<unknown>, message: string) {
    setBusy(key);
    setError('');
    try {
      await action();
      onChanged(message);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy('');
    }
  }

  async function add() {
    if (!name.trim() || !url.trim()) { setError('请填写代理名称和地址。'); return; }
    await run('add', () => api('/proxies', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), url: url.trim() })
    }), '代理已保存');
    setName('');
    setUrl('');
  }

  const proxies = snapshot?.proxies || [];
  const bindings = snapshot?.bindings || {};

  return (
    <div className="panel">
      <div className="panel-head">
        <div><h2>代理出口</h2><p>账号绑定后，认证、额度和模型请求都走该出口；未绑定走进程默认网络。</p></div>
        <span className="badge">{proxies.length} 个代理</span>
      </div>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className="field"><label htmlFor="proxy-name">名称</label><input id="proxy-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：美国-1" /></div>
        <div className="field"><label htmlFor="proxy-url">代理 URL</label><input id="proxy-url" type="password" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:19101" autoComplete="new-password" /></div>
      </div>
      <button className="btn" type="button" onClick={add} disabled={busy === 'add'}>{busy === 'add' ? '保存中…' : '保存代理'}</button>
      {error ? <div className="login-error">{error}</div> : null}
      <div style={{ marginTop: 14 }}>
        {proxies.map((proxy) => {
          const count = Object.values(bindings).filter((id) => id === proxy.id).length;
          const health = proxy.health;
          return (
            <div className="proxy-row" key={proxy.id}>
              <div>
                <div className="strong">{proxy.name}</div>
                <div className="muted tiny">{proxy.endpoint}{proxy.authenticated ? ' · 含认证' : ''}{count ? ` · 绑定 ${count} 个账号` : ''}</div>
              </div>
              <div>
                {health ? (
                  health.ok ? <span className="badge green">可用 · {health.latencyMs ?? 0}ms</span> : <span className="badge red">检测失败</span>
                ) : <span className="badge">未检测</span>}
              </div>
              <div className="muted tiny">{proxy.activeRequests ? `${proxy.activeRequests} 个请求` : '空闲'}</div>
              <div className="table-actions">
                <button className="btn ghost small" type="button" onClick={() => run(`check-${proxy.id}`, () => api(`/proxies/${encodeURIComponent(proxy.id)}/check`, { method: 'POST' }), '代理检测完成')} disabled={Boolean(busy)}>{busy === `check-${proxy.id}` ? '检测中…' : '检测'}</button>
                <button className="btn danger small" type="button" onClick={() => run(`delete-${proxy.id}`, () => api(`/proxies/${encodeURIComponent(proxy.id)}`, { method: 'DELETE' }), '代理已删除')} disabled={Boolean(busy)}>删除</button>
              </div>
            </div>
          );
        })}
        {!proxies.length ? <div className="muted small">还没有登记代理。Gemini App 账号添加前必须先添加代理。</div> : null}
      </div>
    </div>
  );
}
