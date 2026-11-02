'use client';

import { useCallback, useEffect, useState } from 'react';
import { CompactNumber } from '@/components/compact-number';
import { PageHeader } from '@/components/page-header';
import { AlertIcon, RefreshIcon, ScrollIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { API_BASE } from '@/lib/base-path';
import { api, ApiError } from '@/lib/api';
import { fmtNumber, fmtRelative } from '@/lib/format';
import type { AuditEntry, DiagnosticEntry, LogPage, RequestLogEntry } from '@/lib/types';

type Tab = 'requests' | 'diagnostics' | 'audit';

function statusBadge(status: number) {
  if (status >= 200 && status < 300) return <span className="badge green">{status}</span>;
  if (status >= 400 && status < 500) return <span className="badge amber">{status}</span>;
  if (status >= 500) return <span className="badge red">{status}</span>;
  return <span className="badge">{status || '—'}</span>;
}

function timeOf(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>('requests');
  const [days, setDays] = useState('7');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const [ip, setIp] = useState('');
  const [event, setEvent] = useState('');
  const [account, setAccount] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LogPage<RequestLogEntry | DiagnosticEntry | AuditEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<RequestLogEntry | null>(null);
  const [following, setFollowing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearBefore, setClearBefore] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let next: LogPage<RequestLogEntry | DiagnosticEntry | AuditEntry>;
      if (tab === 'requests') {
        const params = new URLSearchParams({ days, page: String(page), size: '20' });
        if (key) params.set('key', key);
        if (model) params.set('model', model);
        if (status) params.set('status', status);
        if (ip) params.set('ip', ip);
        next = await api(`/logs/requests?${params}`);
      } else if (tab === 'diagnostics') {
        const params = new URLSearchParams({ days, page: String(page), size: '20' });
        if (event) params.set('event', event);
        if (account) params.set('account', account);
        next = await api(`/logs/diagnostics?${params}`);
      } else {
        const params = new URLSearchParams({ days, page: String(page), size: '20' });
        if (action) params.set('action', action);
        if (actor) params.set('actor', actor);
        next = await api(`/audit?${params}`);
      }
      setData(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '无法读取日志');
    } finally {
      setLoading(false);
    }
  }, [tab, days, key, model, status, ip, event, account, action, actor, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => { setPage(1); }, [tab, days, key, model, status, ip, event, account, action, actor]);

  useEffect(() => {
    if (!following || page !== 1) return;
    const visible = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(visible, 5000);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [following, page, load]);

  function downloadLogs() {
    if (tab === 'requests') {
      const query = new URLSearchParams({ days, key, model, status, ip });
      const a = document.createElement('a'); a.href = `${API_BASE}/logs/requests/export?${query}`; a.download = 'agy-request-logs.csv'; a.click();
      return;
    }
    const rows = data?.items || [];
    const fields = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const cell = (value: unknown) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [fields.map(cell).join(','), ...rows.map(row => fields.map(field => cell((row as unknown as Record<string, unknown>)[field])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = `agy-${tab}-page-${page}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  async function clearLogs() {
    try {
      await api('/logs/requests', { method: 'DELETE', body: JSON.stringify({ before: new Date(clearBefore).toISOString() }) });
      setClearing(false);
      setPage(1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败');
    }
  }

  const items = data?.items || [];

  return (
    <>
      <PageHeader
        title="日志"
        description="请求日志、账号诊断与操作审计 · 不记录提示词与回复"
        actions={<>
          <button className={following ? 'btn' : 'btn ghost'} type="button" aria-pressed={following} onClick={() => { setFollowing(!following); setPage(1); }}>{following ? '暂停实时' : '实时尾随'}</button>
          <button className="btn ghost" type="button" disabled={!data} onClick={downloadLogs}>{tab === 'requests' ? '导出筛选 CSV' : '导出本页 CSV'}</button>
          {tab === 'requests' ? <button className="btn danger" type="button" onClick={() => setClearing(true)}><ScrollIcon size={14} />清理</button> : null}
          <button className="btn ghost" type="button" onClick={() => void load()}><RefreshIcon size={14} />刷新</button>
        </>}
      />

      {error ? <div className="notice bad" style={{ marginBottom: 12 }}><AlertIcon size={16} /><span>{error}</span></div> : null}

      <div className="tabs">
        <button className={tab === 'requests' ? 'on' : ''} type="button" onClick={() => setTab('requests')}>请求日志</button>
        <button className={tab === 'diagnostics' ? 'on' : ''} type="button" onClick={() => setTab('diagnostics')}>账号诊断</button>
        <button className={tab === 'audit' ? 'on' : ''} type="button" onClick={() => setTab('audit')}>操作审计</button>
      </div>

      <div className="log-filters">
        <select value={days} onChange={(event) => setDays(event.target.value)}>
          <option value="1">今天</option><option value="7">近 7 天</option><option value="30">近 30 天</option>
        </select>
        {tab === 'requests' ? <>
          <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="密钥名称或 ID" />
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型" />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">全部状态</option><option value="2xx">2xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option><option value="200">200</option><option value="401">401</option><option value="429">429</option>
          </select>
          <input value={ip} onChange={(event) => setIp(event.target.value)} placeholder="来源 IP" />
        </> : null}
        {tab === 'diagnostics' ? <>
          <input value={event} onChange={(event) => setEvent(event.target.value)} placeholder="事件类型" />
          <input value={account} onChange={(event) => setAccount(event.target.value)} placeholder="账号" />
        </> : null}
        {tab === 'audit' ? <>
          <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="动作，如 account.update" />
          <input value={actor} onChange={(event) => setActor(event.target.value)} placeholder="操作者" />
        </> : null}
      </div>

      <div className="panel" style={{ padding: '8px 12px 4px' }}>
        {loading && !data ? <div className="skeleton" style={{ height: 220 }} /> : (
          <table className="table">
            {tab === 'requests' ? <>
              <thead><tr><th>时间</th><th>密钥</th><th>模型</th><th>账号</th><th>状态</th><th className="num">延迟</th><th className="num">Token</th><th>IP</th></tr></thead>
              <tbody>
                {(items as RequestLogEntry[]).map((row) => (
                  <tr key={row.id} onClick={() => setDetail(row)} style={{ cursor: 'pointer' }}>
                    <td className="muted">{timeOf(row.ts)}</td><td>{row.keyName || row.key || '—'}</td><td>{row.model || '—'}</td><td className="muted">{row.accountLabel || '—'}</td><td>{statusBadge(row.status)}</td><td className="num">{row.latencyMs}ms</td><td className="num"><CompactNumber value={row.total} /></td><td className="muted">{row.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </> : null}
            {tab === 'diagnostics' ? <>
              <thead><tr><th>时间</th><th>事件</th><th>账号</th><th>结果</th><th className="num">耗时</th><th>详情</th></tr></thead>
              <tbody>
                {(items as DiagnosticEntry[]).map((row, index) => (
                  <tr key={`${row.at}-${index}`}>
                    <td className="muted">{timeOf(row.at)}</td><td>{row.event}</td><td className="muted">{String(row.accountLabel || '—')}</td><td>{row.errorCode ? <span className="badge red">{String(row.errorCode)}</span> : <span className="badge green">ok</span>}</td><td className="num">{row.durationMs ? `${row.durationMs}ms` : '—'}</td><td className="muted tiny">{String(row.message || row.reason || row.category || '')}</td>
                  </tr>
                ))}
              </tbody>
            </> : null}
            {tab === 'audit' ? <>
              <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>结果</th><th>IP</th><th className="num">耗时</th></tr></thead>
              <tbody>
                {(items as AuditEntry[]).map((row, index) => (
                  <tr key={`${row.ts}-${index}`}>
                    <td className="muted">{timeOf(row.ts)}</td><td>{row.actor}</td><td>{row.action}</td><td className="muted">{row.target || '—'}</td><td>{row.result === 'ok' ? <span className="badge green">ok</span> : row.result === 'pending' ? <span className="badge amber">pending</span> : <span className="badge red">{row.result}</span>}</td><td className="muted">{row.ip}</td><td className="num">{row.durationMs ? `${row.durationMs}ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </> : null}
            {!items.length ? <tbody><tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>没有匹配的日志</td></tr></tbody> : null}
          </table>
        )}
      </div>
      <div className="footer">
        <span>请求日志保留 30 天 · 导出最多扫描最近 20,000 条 · 实时尾随每 5 秒更新</span>
        <span className="flex" style={{ gap: 8 }}>
          <button className="btn ghost small" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
          <span>第 {data?.page || page} 页 · 共 {data?.total || 0} 条</span>
          <button className="btn ghost small" type="button" disabled={!data?.hasMore} onClick={() => { setFollowing(false); setPage((value) => value + 1); }}>下一页</button>
        </span>
      </div>

      {detail ? (
        <Modal title="请求详情" description={`${detail.id} · ${detail.model || '未知模型'}`} onClose={() => setDetail(null)}>
          <pre className="log-detail">{JSON.stringify(detail, null, 2)}</pre>
        </Modal>
      ) : null}

      {clearing ? (
        <Modal title="清理请求日志" description="只删除截止时间之前的记录，不可撤销。" onClose={() => setClearing(false)} footer={<>
          <button className="btn ghost" type="button" onClick={() => setClearing(false)}>取消</button>
          <button className="btn danger" type="button" onClick={clearLogs}>确认清理</button>
        </>}>
          <div className="form-grid"><div className="field"><label htmlFor="clear-before">截止时间</label><input id="clear-before" type="datetime-local" value={clearBefore} onChange={(event) => setClearBefore(event.target.value)} /></div></div>
        </Modal>
      ) : null}
    </>
  );
}
