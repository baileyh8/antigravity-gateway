'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CompactNumber } from '@/components/compact-number';
import { PageHeader } from '@/components/page-header';
import { UsageChart, type UsagePoint } from '@/components/usage-chart';
import { api } from '@/lib/api';
import { fmtCompact, fmtNumber, fmtPercent } from '@/lib/format';
import type { Counters, TrendPoint } from '@/lib/types';

type Row = { id: string; name: string; tokens: number; requests: number; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null; successRate: number | null; avgLatencyMs?: number | null; latencySamples?: number; cacheHitRate?: number | null };
type Usage = { days: number; groupBy: string; totals: Counters; items: Row[]; trend: UsagePoint[]; series: Array<{id: string; name: string}>; grain: string; strideHours: number | null; note: string; timezone: string; requestBasis: string };
const cell = (value: number | null) => <CompactNumber value={value} />;

export default function UsagePage() {
  const [days, setDays] = useState(7);
  const [group, setGroup] = useState('model');
  const [grain, setGrain] = useState('day');
  const sequence = useRef(0);
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    try { const next = await api<Usage>(`/usage?days=${days}&groupBy=${group}&grain=${grain}`); if (current === sequence.current) { setData(next); setError(''); } }
    catch (err) { if (current === sequence.current) { setData(null); setError(err instanceof Error ? err.message : '用量读取失败'); } }
    finally { if (current === sequence.current) setLoading(false); }
  }, [days, group, grain]);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000); const visible = () => { if (!document.hidden) void load(); }; document.addEventListener('visibilitychange', visible); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); }; }, [load]);
  function download() {
    if (!data) return;
    const safe = (v: unknown) => `"${String(v ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
    const rows = [['名称', 'Token', '调用数', '输入', '输出', '缓存', '上游成功率%', '缓存命中率%', '平均延迟ms', '延迟样本'], ...data.items.map(r => [r.name, r.tokens, r.requests, r.inputTokens ?? '', r.outputTokens ?? '', r.cachedTokens ?? '', r.successRate ?? '', r.cacheHitRate ?? '', r.avgLatencyMs ?? '', r.latencySamples ?? ''])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(r => r.map(safe).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `agy-usage-${data.groupBy}-${data.days}d.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const t = data?.totals;
  return <>
    <PageHeader title="用量" description="按日或小时汇总，最多查询 31 天" actions={<><button className="btn ghost" onClick={() => void load()} disabled={loading}>{loading ? '读取中…' : '刷新'}</button><button className="btn" disabled={!data || loading} onClick={download}>导出 CSV</button></>} />
    {error ? <div className="notice bad" role="alert">{error}</div> : null}
    <div className="cards c6 usage-summary">{[
      ['总 Token', fmtCompact(t?.totalTokens)], ['输入', fmtCompact(t?.inputTokens)], ['输出', fmtCompact(t?.outputTokens)], ['缓存命中率', t?.inputTokens ? fmtPercent(t.cachedTokens / t.inputTokens * 100, 1) : '—', `缓存读取 ${fmtCompact(t?.cachedTokens)}`], ['客户端请求', fmtCompact(t?.clientRequests)], ['上游成功率', t?.upstreamCalls ? fmtPercent(t.successfulUpstreamCalls / t.upstreamCalls * 100, 1) : '—']
    ].map(([label, value, hint]) => <div className="card" key={label}><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{hint ? <div className="stat-hint">{hint}</div> : null}</div>)}</div>
    <div className="log-filters" style={{ marginTop: 12 }}><select aria-label="时间范围" value={days} onChange={e => { setData(null); setDays(Number(e.target.value)); }}><option value={1}>今天</option><option value={7}>近 7 天</option><option value={14}>近 14 天</option><option value={30}>近 30 天</option><option value={31}>近 31 天</option></select><div className="seg">{[['model', '按模型'], ['account', '按账号'], ['key', '按密钥']].map(([value, label]) => <button key={value} className={value === group ? 'on' : ''} onClick={() => { setData(null); setGroup(value); if (value === 'key') setGrain('day'); }}>{label}</button>)}</div><select aria-label="统计粒度" value={grain} onChange={e => { setData(null); setGrain(e.target.value); }}><option value="day">按日</option><option value="hour" disabled={group === 'key'}>按小时</option></select><span className="muted tiny">{data?.timezone || ''} · 每 30 秒更新</span></div>
    <div className="panel"><div className="panel-head"><div><h2>调用趋势</h2><p>柱：分组 Token · 线：客户端请求{data?.strideHours && data.strideHours > 1 ? ` · 每 ${data.strideHours} 小时一格` : ''}{group === 'key' ? ' · 密钥按日统计' : ''}</p></div></div><UsageChart key={`${group}:${grain}`} points={data?.trend || []} series={data?.series || []} grain={grain} timezone={data?.timezone} /></div>
    <div className="panel" style={{ marginTop: 12, overflowX: 'auto' }}><table className="table"><thead><tr><th>名称</th><th className="num">Token</th><th className="num">{group === 'key' ? '客户端请求' : '上游调用'}</th><th className="num">占比</th><th className="num">输入 / 输出</th><th className="num">缓存 / 命中</th><th className="num">平均延迟</th><th className="num">上游成功率</th></tr></thead><tbody>{data?.items.map(r => <tr key={r.id}><td className="strong">{r.name}</td><td className="num"><CompactNumber value={r.tokens} /></td><td className="num"><CompactNumber value={r.requests} /></td><td className="num">{fmtPercent(t?.totalTokens ? r.tokens / t.totalTokens * 100 : 0, 1)}</td><td className="num">{cell(r.inputTokens)} / {cell(r.outputTokens)}</td><td className="num">{cell(r.cachedTokens)}<div className="tiny muted">{r.cacheHitRate == null ? '—' : fmtPercent(r.cacheHitRate, 1)}</div></td><td className="num">{r.avgLatencyMs == null ? '—' : `${Math.round(r.avgLatencyMs)}ms`}<div className="tiny muted">{r.latencySamples ? `${fmtNumber(r.latencySamples)} 样本` : '无历史样本'}</div></td><td className="num">{r.successRate === null ? '—' : fmtPercent(r.successRate, 1)}</td></tr>)}{!data?.items.length ? <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>{loading ? '读取中…' : '该范围暂无用量'}</td></tr> : null}</tbody></table></div>
    <div className="footer"><span>{data?.note}</span></div>
  </>;
}
