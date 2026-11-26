'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { fmtTime } from '@/lib/format';
import { ProxyPanel } from '@/components/accounts/proxy-panel';
import { RefreshIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import type { ProxySnapshot } from '@/lib/types';

type Settings = { user: { username: string; role: string }; managerVersion: string; gateway: { ok: boolean; version?: string }; requestLogRetentionDays: number; auditRetentionDays: number; initialPasswordPending: boolean; passwordChangedAt: string | null };

export default function SettingsPage() {
  const { me } = useAuth();
  const [proxies, setProxies] = useState<ProxySnapshot | null>(null);
  const [proxyError, setProxyError] = useState('');
  const [proxyMessage, setProxyMessage] = useState('');
  const [data, setData] = useState<Settings | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() { try { setData(await api<Settings>('/settings')); } catch (err) { setError(err instanceof Error ? err.message : '设置读取失败'); } }
  useEffect(() => { void load(); }, []);
  async function loadProxies() {
    try { setProxies(await api<ProxySnapshot>('/proxies')); setProxyError(''); }
    catch (err) { setProxyError(err instanceof Error ? err.message : '代理读取失败'); }
  }
  useEffect(() => { void loadProxies(); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (next !== confirm) { setError('两次新密码不一致。'); return; }
    setBusy(true);
    try { await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) }); setCurrent(''); setNext(''); setConfirm(''); setMessage('密码已更新，其他已登录会话已失效。'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : '修改失败'); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeader title="设置" description="账户安全、出口代理与网关信息" />
    {error ? <div className="notice bad" role="alert">{error}</div> : null}{message ? <div className="notice info" role="status">{message}</div> : null}
    <div className="row r11">
      <section className="panel"><div className="panel-head"><div><h2>账户安全</h2><p>{data?.user.username || '—'} · {data?.user.role === 'admin' ? '管理员' : '只读用户'}</p></div></div>
        {data?.initialPasswordPending ? <div className="notice info">当前仍使用初始化密码，修改成功后会自动移除初始化密码文件。</div> : null}
        {data?.user.role === 'admin' ? <form className="form-grid" onSubmit={save}>
          <div className="field"><label htmlFor="current-password">当前密码</label><input id="current-password" type="password" autoComplete="current-password" maxLength={200} required value={current} onChange={e => setCurrent(e.target.value)} /></div>
          <div className="form-row"><div className="field"><label htmlFor="new-password">新密码</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={next} onChange={e => setNext(e.target.value)} /></div><div className="field"><label htmlFor="confirm-password">确认新密码</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div></div>
          <p className="muted tiny">12–200 位，包含字母及数字或符号。上次修改：{fmtTime(data.passwordChangedAt)}</p>
          <div><button className="btn" disabled={busy} type="submit">{busy ? '保存中…' : '更新密码'}</button></div>
        </form> : null}
      </section>
      <section className="panel"><div className="panel-head"><div><h2>运行信息</h2><p>代理逻辑由基座运行</p></div><span className={`badge ${data?.gateway.ok ? 'green' : ''}`}>{data?.gateway.ok ? '已连接' : '离线'}</span></div>
        <table className="table"><tbody>{[['管理后台', data?.managerVersion], ['代理基座', data?.gateway.version], ['请求日志', `${data?.requestLogRetentionDays || 30} 天`], ['操作审计', `${data?.auditRetentionDays || 180} 天`], ['管理入口', '/admin/'], ['旧看板', '/dashboard → 301 /admin/']].map(([key, value]) => <tr key={key}><td className="muted">{key}</td><td>{value || '—'}</td></tr>)}</tbody></table>
      </section>
    </div>
    <section id="proxies" className="settings-proxies" aria-label="代理设置">
      <div className="settings-section-head"><h2>代理设置</h2><button className="btn ghost small" type="button" onClick={() => void loadProxies()}><RefreshIcon size={14} />刷新代理</button></div>
      {proxyError ? <div className="notice bad" role="alert">{proxyError}</div> : null}
      {proxyMessage ? <div className="notice info" role="status">{proxyMessage}</div> : null}
      {!proxies && !proxyError ? <div className="skeleton proxy-loading" aria-label="正在读取代理" />
        : proxies ? <ProxyPanel snapshot={proxies} readOnly={me?.role !== 'admin'} onChanged={(text) => { setProxyMessage(text); void loadProxies(); }} /> : null}
    </section>
  </>;
}
