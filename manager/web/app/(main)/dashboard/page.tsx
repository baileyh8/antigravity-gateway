'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { TrendChart } from '@/components/trend-chart';
import { AlertIcon, GaugeIcon, RefreshIcon, RequestIcon, ServerIcon, TokenIcon, UsersIcon } from '@/components/icons';
import { QuotaChips } from '@/components/quota-chips';
import { api, ApiError } from '@/lib/api';
import { fmtBytes, fmtCompact, fmtNumber, fmtPercent, fmtUptime } from '@/lib/format';
import { lowestOverall } from '@/lib/quota';
import type { Account, Overview } from '@/lib/types';

function stateBadge(account: Account) {
  if (account.state === 'available') return <span className="badge green"><span className="dot" />可用</span>;
  if (account.state === 'cooldown') return <span className="badge amber"><span className="dot amber" />冷却</span>;
  if (account.state === 'disabled') return <span className="badge"><span className="dot gray" />禁用</span>;
  return <span className="badge red"><span className="dot red" />异常</span>;
}

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<Overview>('/overview');
      setData(next);
      setError('');
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '无法连接管理服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const today = data?.usage.today;
  const cacheBase = (today?.inputTokens || 0) + (today?.cachedTokens || 0);
  const cacheRate = cacheBase > 0 ? ((today?.cachedTokens || 0) / cacheBase) * 100 : null;
  const successRate = today && today.upstreamCalls > 0
    ? (today.successfulUpstreamCalls / today.upstreamCalls) * 100
    : null;

  const healthAccounts = useMemo(() => {
    if (!data) return [];
    return [...data.accounts.items]
      .sort((left, right) => {
        const rank = (account: Account) => account.state === 'available' ? 0 : account.state === 'cooldown' ? 1 : account.state === 'disabled' ? 3 : 2;
        const byState = rank(left) - rank(right);
        if (byState !== 0) return byState;
        return (lowestOverall(left)?.fraction ?? 1) - (lowestOverall(right)?.fraction ?? 1);
      })
      .slice(0, 3);
  }, [data]);

  const problemAccounts = useMemo(() => {
    if (!data) return [];
    return data.accounts.items.filter((account) => account.state === 'error' || account.state === 'cooldown').slice(0, 3);
  }, [data]);

  const tightest = useMemo(() => {
    if (!data) return null;
    let best: { account: Account; cell: ReturnType<typeof lowestOverall> } | null = null;
    for (const account of data.accounts.items) {
      const cell = lowestOverall(account);
      if (cell && (!best || cell.fraction < (best.cell?.fraction ?? 1))) best = { account, cell };
    }
    return best;
  }, [data]);

  if (loading && !data) {
    return (
      <>
        <PageHeader title="看板" description="正在读取基座状态…" />
        <div className="cards c5">
          {Array.from({ length: 5 }).map((_, index) => <div key={index} className="card"><div className="skeleton" style={{ height: 64 }} /></div>)}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="看板"
        description="账号池健康度、网关状态与今日用量 · 每 30 秒刷新"
        actions={<button className="btn ghost" type="button" onClick={() => void load()}><RefreshIcon size={14} />刷新</button>}
      />

      {error ? (
        <div className="notice bad" style={{ marginBottom: 12 }} role="alert">
          <AlertIcon size={16} />
          <span>{error}{data ? ' · 下面是上次成功获取的数据' : ''}</span>
        </div>
      ) : null}

      <div className="cards c5">
        <StatCard
          label="可用账号"
          icon={<UsersIcon size={14} />}
          value={data ? <>{data.accounts.available}<small> / {data.accounts.total}</small></> : '—'}
          hint={data ? `${data.accounts.cooldown} 个冷却 · ${data.accounts.disabled} 个禁用` : '等待基座恢复'}
          hintTone={data && data.accounts.error > 0 ? 'bad' : undefined}
        />
        <StatCard
          label="今日 Token"
          icon={<TokenIcon size={14} />}
          value={data ? fmtCompact(today?.totalTokens) : '—'}
          hint={data ? `输入 ${fmtCompact(today?.inputTokens)} · 输出 ${fmtCompact(today?.outputTokens)}${cacheRate == null ? '' : ` · 缓存 ${fmtPercent(cacheRate, 1)}`}` : '等待基座恢复'}
        />
        <StatCard
          label="今日请求"
          icon={<RequestIcon size={14} />}
          value={data ? fmtCompact(today?.clientRequests) : '—'}
          hint={!data ? '等待基座恢复' : successRate == null ? '尚无上游调用' : `成功 ${fmtPercent(successRate, 1)} · 失败 ${fmtNumber(today?.failedUpstreamCalls)}`}
          hintTone={successRate != null && successRate < 95 ? 'warn' : undefined}
        />
        <StatCard
          label="额度最紧"
          icon={<GaugeIcon size={14} />}
          value={tightest?.cell ? `${Math.round(tightest.cell.fraction * 100)}%` : '—'}
          hint={tightest?.cell ? `${tightest.cell.groupLabel} · ${tightest.account.emailMasked}` : data ? '没有额度数据' : '等待基座恢复'}
          hintTone={tightest?.cell && tightest.cell.fraction < 0.2 ? 'bad' : tightest?.cell && tightest.cell.fraction < 0.5 ? 'warn' : undefined}
        />
        <StatCard
          label="网关运行"
          icon={<ServerIcon size={14} />}
          value={<span style={{ fontSize: 24 }}>{data ? fmtUptime(data.uptimeSeconds) : '—'}</span>}
          hint={`版本 ${data?.version || '—'}`}
        />
      </div>

      <div className="row r21">
        <div className="panel">
          <div className="panel-head">
            <div><h2>近 14 天调用趋势</h2><p>请求数（柱）与 Token（线）</p></div>
            <span className="badge">总计 {data ? fmtCompact(data.trend.reduce((sum, point) => sum + point.tokens, 0)) : '—'}</span>
          </div>
          <TrendChart points={data?.trend || []} />
        </div>
        <div className="panel">
          <div className="panel-head">
            <div><h2>网关状态</h2><p>基座运行信息</p></div>
            <span className={error ? 'badge red' : 'badge green'}>
              <span className={`dot${error ? ' red' : ''}`} />{error ? '离线' : '在线'}
            </span>
          </div>
          <div className="kv"><span>版本</span><b>{data?.version || '—'}</b></div>
          <div className="kv"><span>运行时长</span><b>{data ? fmtUptime(data.uptimeSeconds) : '—'}</b></div>
          <div className="kv"><span>传输模式</span><b>{data?.transport || '—'}</b></div>
          <div className="kv"><span>并发</span><b>{data ? `${data.concurrency.active} / ${data.concurrency.limit}${data.concurrency.queued ? ` · 排队 ${data.concurrency.queued}` : ''}` : '—'}</b></div>
          <div className="kv"><span>请求内存</span><b>{data?.concurrency.memory?.body ? `${fmtBytes(data.concurrency.memory.body.used)} / ${fmtBytes(data.concurrency.memory.body.limit)}` : '—'}</b></div>
          <div className="kv"><span>默认模型</span><b>{data?.defaultModel || '—'}</b></div>
        </div>
      </div>

      <div className="row r12">
        <div className="panel">
          <div className="panel-head">
            <div><h2>账号健康快照</h2><p>按状态与额度排序</p></div>
            <span className="badge">{data ? `${data.accounts.total} 个账号` : '—'}</span>
          </div>
          <div>
            {healthAccounts.length ? healthAccounts.map((account) => (
              <div className="health-row" key={account.id}>
                <div className="health-name">
                  <span>{account.emailMasked || account.id}</span>
                  {stateBadge(account)}
                </div>
                <QuotaChips account={account} />
              </div>
            )) : <div className="muted small">{data ? '暂无账号' : '等待基座恢复'}</div>}
          </div>
        </div>
        <div className="stack">
          <div className="panel">
            <div className="panel-head"><div><h2>需要关注</h2><p>冷却与异常账号</p></div><span className="badge">{data ? problemAccounts.length : '—'}</span></div>
            {problemAccounts.length ? problemAccounts.map((account) => (
              <div className="kv" key={account.id}><span>{account.emailMasked || account.id}</span><b>{account.state === 'cooldown' ? '冷却中' : '异常'}</b></div>
            )) : <div className="muted small">{data ? '没有需要处理的账号' : '等待基座恢复'}</div>}
          </div>
          <div className="panel">
            <div className="panel-head"><div><h2>密钥与日志</h2><p>密钥访问控制与请求追踪</p></div></div>
            <div className="notice info"><span>可在密钥页创建独立凭据、设置模型与配额限制；请求日志提供状态、耗时与 Token 追踪。</span></div>
          </div>
        </div>
      </div>

      <div className="footer">
        <span>数据来自基座管理 API · 页面隐藏时暂停刷新</span>
        <span>{updatedAt ? `上次成功更新 ${updatedAt.toLocaleTimeString('zh-CN', { hour12: false })}` : '尚未更新'}</span>
      </div>
    </>
  );
}
