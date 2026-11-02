'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { OAuthStatus, ProxySnapshot } from '@/lib/types';
import { Modal } from '@/components/modal';

const PENDING = ['starting', 'waiting', 'checking'];

export function AddAccountDialog({
  proxies,
  onClose,
  onAdded
}: {
  proxies: ProxySnapshot | null;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const [provider, setProvider] = useState<'cloudcode' | 'robin'>('cloudcode');
  const [proxyId, setProxyId] = useState('');
  const [flow, setFlow] = useState<OAuthStatus | null>(null);
  const [callback, setCallback] = useState('');
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const notified = useRef(false);

  useEffect(() => {
    if (!flow || !PENDING.includes(flow.state)) return;
    const id = flow.id;
    const flowProvider = flow.provider;
    const timer = window.setInterval(async () => {
      try {
        const next = await api<OAuthStatus>(`/accounts/oauth/${encodeURIComponent(id)}?provider=${encodeURIComponent(flowProvider)}`);
        setFlow(next);
        if (next.state === 'complete' && !notified.current) {
          notified.current = true;
          onAdded('账号已添加，凭据已保存');
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setFlow((current) => current ? { ...current, state: 'failed', error: '授权流程已过期，请重新发起。' } : current);
        }
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [flow?.id, flow?.state, flow?.provider, onAdded]);

  async function start() {
    setError('');
    if (provider === 'robin' && !proxyId) {
      setError('Gemini App 授权必须选择出口代理。');
      return;
    }
    setStarting(true);
    try {
      const next = await api<OAuthStatus>('/accounts/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider, proxyId })
      });
      notified.current = false;
      setFlow(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法发起授权');
    } finally {
      setStarting(false);
    }
  }

  async function submit() {
    if (!flow) return;
    setError('');
    setSubmitting(true);
    try {
      const next = await api<OAuthStatus>('/accounts/oauth/callback', {
        method: 'POST',
        body: JSON.stringify({ provider: flow.provider, id: flow.id, callback: callback.trim() })
      });
      setFlow(next);
      setCallback('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '回调提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!flow) return;
    try {
      const next = await api<OAuthStatus>(`/accounts/oauth/${encodeURIComponent(flow.id)}/cancel?provider=${encodeURIComponent(flow.provider)}`, {
        method: 'POST',
        body: JSON.stringify({ provider: flow.provider })
      });
      setFlow(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消失败');
    }
  }

  async function copyLink() {
    if (!flow?.url) return;
    try { await navigator.clipboard.writeText(flow.url); } catch { /* the link is selectable */ }
  }

  const pending = flow && PENDING.includes(flow.state);

  return (
    <Modal
      title="添加账号"
      description="授权链接在本地浏览器打开，回调地址粘回这里。"
      onClose={onClose}
      footer={<>
        {flow && pending ? <button className="btn ghost" type="button" onClick={cancel}>取消授权</button> : null}
        <button className="btn ghost" type="button" onClick={onClose}>{flow?.state === 'complete' ? '完成' : '关闭'}</button>
      </>}
    >
      {!flow ? (
        <div className="form-grid">
          <div className="form-row">
            <div className="field">
              <label htmlFor="provider">账号来源</label>
              <select id="provider" value={provider} onChange={(event) => setProvider(event.target.value as 'cloudcode' | 'robin')}>
                <option value="cloudcode">Antigravity（Cloud Code）</option>
                <option value="robin">Gemini App（Argon）</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="add-proxy">出口代理{provider === 'robin' ? '（必选）' : '（可选）'}</label>
              <select id="add-proxy" value={proxyId} onChange={(event) => setProxyId(event.target.value)}>
                <option value="">{provider === 'robin' ? '请选择代理' : '默认出口'}</option>
                {(proxies?.proxies || []).map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name} · {proxy.endpoint}</option>)}
              </select>
            </div>
          </div>
          <div className="notice info">
            <span>Antigravity 账号授权完成后会自动重检并刷新额度；Gemini App 账号会绑定所选代理。授权链接和回调地址包含一次性凭据，不要分享。</span>
          </div>
          {error ? <div className="login-error">{error}</div> : null}
          <button className="btn" type="button" onClick={start} disabled={starting}>{starting ? '正在创建授权…' : '开始授权'}</button>
        </div>
      ) : (
        <div className="form-grid">
          {flow.state === 'waiting' ? (
            <>
              <div className="field">
                <label>1. 在本地浏览器打开授权页</label>
                <a className="oauth-link" href={flow.url} target="_blank" rel="noopener noreferrer">{flow.url}</a>
                <button className="btn ghost small" type="button" onClick={copyLink} style={{ alignSelf: 'flex-start' }}>复制授权链接</button>
              </div>
              <div className="field">
                <label htmlFor="callback">2. 登录后若跳到 127.0.0.1 无法访问，复制地址栏完整链接</label>
                <textarea id="callback" value={callback} onChange={(event) => setCallback(event.target.value)} placeholder="http://localhost:…/oauth-callback?code=…" />
              </div>
              <button className="btn" type="button" onClick={submit} disabled={submitting || !callback.trim()}>{submitting ? '提交中…' : '完成授权'}</button>
            </>
          ) : null}
          {flow.state === 'starting' ? <div className="notice info"><span>正在创建授权链接…</span></div> : null}
          {flow.state === 'checking' ? <div className="notice info"><span>正在验证授权并保存账号，请稍候…</span></div> : null}
          {flow.state === 'complete' ? (
            <div className="notice" style={{ background: 'rgba(5,150,105,.1)', color: '#047857' }}>
              <span>账号已保存{flow.account?.emailMasked ? `：${flow.account.emailMasked}` : ''}。列表会自动刷新。</span>
            </div>
          ) : null}
          {flow.state === 'failed' || flow.state === 'cancelled' ? (
            <div className="login-error">{flow.error || '授权未完成，请重新发起。'}</div>
          ) : null}
          {error ? <div className="login-error">{error}</div> : null}
        </div>
      )}
    </Modal>
  );
}
