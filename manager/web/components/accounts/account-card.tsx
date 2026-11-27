import { useState } from 'react';
import { accountHealth, accountPlan, quotaIsStale, resetTimeLabel } from '@/lib/account-presentation';
import { fmtRelative, fmtTime } from '@/lib/format';
import { quotaBucketKey, quotaBucketLabel, quotaGroupLabel } from '@/lib/quota';
import { BASE_PATH } from '@/lib/base-path';
import type { Account, ProxySnapshot, QuotaBucket } from '@/lib/types';

function QuotaValue({ bucket, group, window, now }: { bucket?: QuotaBucket; group: string; window: string; now: number }) {
  const fraction = bucket && Number.isFinite(bucket.remainingFraction) ? Math.min(1, Math.max(0, bucket.remainingFraction)) : null;
  const percent = fraction == null ? null : Math.round(fraction * 100);
  const tone = percent == null ? '' : percent < 20 ? 'red' : percent < 50 ? 'amber' : 'green';
  const validReset = Boolean(bucket?.resetTime && Number.isFinite(Date.parse(bucket.resetTime)));
  return <div className="account-quota-value">
    <div className="account-quota-number">
      <div className="bar" role={percent == null ? undefined : 'meter'} aria-label={`${group} ${window}剩余额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <i className={tone} style={{ width: `${percent ?? 0}%` }} />
      </div><b>{percent == null ? '—' : `${percent}%`}</b>
    </div>
    {validReset ? <time className="account-quota-reset" dateTime={bucket!.resetTime} title={`${resetTimeLabel(bucket!.resetTime, now)} · ${fmtTime(bucket!.resetTime)}`}>
      {Date.parse(bucket!.resetTime) <= now ? '待刷新' : new Date(bucket!.resetTime).toLocaleString('zh-CN', {
        ...(window === '5h' ? {} : { month: '2-digit', day: '2-digit' }), hour: '2-digit', minute: '2-digit', hour12: false
      })}
    </time> : <span className="account-quota-reset">{bucket ? '重置时间未知' : '无此窗口'}</span>}
  </div>;
}

export function AccountCard({ account, proxies, proxyError, now, canEdit, toggling, checking, recheckBlocked, onToggle, onEdit, onRecheck, onDelete }: {
  account: Account; proxies: ProxySnapshot | null; proxyError: boolean; now: number; canEdit: boolean;
  toggling: boolean; checking: boolean; recheckBlocked: boolean;
  onToggle: () => void; onEdit: () => void; onRecheck: () => void; onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const health = accountHealth(account);
  const bindingKey = account.providerType === 'robin' ? `robin:${account.id}` : account.id;
  const proxyId = proxies?.bindings[bindingKey];
  const proxy = proxies?.proxies.find((item) => item.id === proxyId);
  const groups = account.quota?.groups || [];
  const stale = quotaIsStale(account.quota, now);
  const updatedAt = account.quota?.observedAt || account.quota?.updatedAt;
  const failure = account.healthMessage || account.lastError;
  const healthUpdatedAt = account.healthCheckedAt;
  const updateText = !groups.length && healthUpdatedAt ? `${fmtRelative(healthUpdatedAt)}核验` : stale ? '历史数据' : updatedAt ? `${fmtRelative(updatedAt)}更新` : '未刷新';
  const detailId = `account-detail-${account.providerType}-${account.id}`;

  return <article className={`account-card${!account.enabled ? ' paused' : ''}`} aria-label={account.email || account.id}>
    <header className="account-card-head">
      <h2 title={account.id}>{account.email || account.id}</h2>
      <button className={`switch compact${account.enabled ? ' on' : ''}`} type="button" role="switch"
        aria-checked={account.enabled} aria-label={`${account.enabled ? '暂停' : '启用'} ${account.email || account.id}`}
        title={toggling ? '保存中…' : account.enabled ? '点击暂停调度' : '点击启用调度'}
        disabled={!canEdit || toggling || checking} onClick={onToggle} />
    </header>
    <div className="account-badges">
      <span className={`account-health ${health.tone}`} title={failure || '账号健康状态'}><i aria-hidden="true" />{health.label}</span>
      <span className="account-plan">{accountPlan(account)}</span>
      <span className="account-enabled">{toggling ? '保存中…' : account.enabled ? '已启用' : '已暂停'}</span>
    </div>

    <section className={`account-quota${stale ? ' stale' : ''}`} aria-label="账号额度">
      {groups.length ? <>
        <div className="account-quota-head"><span>{stale ? '历史额度' : '额度 / 重置'}</span><span>5h</span><span>每周</span></div>
        {groups.map((group) => <div className="account-quota-group" key={group.id}>
          <h3 title={group.description}>{quotaGroupLabel(group)}</h3>
          <QuotaValue group={quotaGroupLabel(group)} window="5h" now={now} bucket={group.buckets.find((bucket) => quotaBucketKey(bucket) === '5h')} />
          <QuotaValue group={quotaGroupLabel(group)} window="每周" now={now} bucket={group.buckets.find((bucket) => quotaBucketKey(bucket) === 'weekly')} />
        </div>)}
      </> : <p className="account-quota-empty">{health.key === 'tos' || health.label === '访问受限' ? '访问受限 · 暂无额度数据' : '暂无额度数据'}{!account.enabled ? <small>已暂停，未自动探测</small> : null}</p>}
    </section>

    <dl className="account-meta"><div><dt>代理</dt><dd title={proxy?.endpoint}>
      <span>{proxyError ? '代理信息读取失败' : !proxies ? '读取中…' : proxy?.name || (proxyId ? '绑定代理不可用' : '默认出口')}</span>
      <a href={`${BASE_PATH}/settings/#proxies`} aria-label="前往设置管理代理">管理</a>
    </dd></div></dl>
    <div className="account-note"><span>备注</span><p title={account.note || ''}>{account.note || '暂无备注'}</p></div>
    <footer className="account-card-actions">
      {canEdit ? <button className="account-text-button" type="button" aria-label="编辑账号" onClick={onEdit} disabled={toggling || checking}>编辑 / 备注</button> : <span className="account-readonly">只读</span>}
      <span className={`account-updated${stale ? ' stale' : ''}`} title={updatedAt ? fmtTime(updatedAt) : '暂无更新时间'}>{updateText}</span>
      <button className="account-text-button" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '详情'}</button>
    </footer>
    {expanded ? <section className="account-details" id={detailId} aria-label="账号详情">
      {failure && health.key !== 'healthy' ? <p className="account-health-detail">{failure}</p> : null}
      {stale ? <p className="account-stale-note">额度记录已过期，等待上游刷新。</p> : null}
      <dl><div><dt>账号 ID</dt><dd>{account.id}</dd></div><div><dt>来源 / 权重</dt><dd>{account.providerType === 'robin' ? 'Gemini App' : 'Antigravity'} / {account.weight}</dd></div>
        <div><dt>健康核验</dt><dd>{fmtTime(healthUpdatedAt)}</dd></div><div><dt>最近成功</dt><dd>{fmtTime(account.lastSuccessAt)}</dd></div>
        {account.cooldownUntil && Date.parse(account.cooldownUntil) > now ? <div><dt>冷却结束</dt><dd>{fmtTime(account.cooldownUntil)}</dd></div> : null}
        <div><dt>完整备注</dt><dd>{account.note || '暂无备注'}</dd></div>
        {groups.flatMap((group) => group.buckets.map((bucket) => <div key={`${group.id}-${bucket.id}`}><dt>{quotaGroupLabel(group)} {quotaBucketLabel(bucket)}</dt><dd>{resetTimeLabel(bucket.resetTime, now)} · {fmtTime(bucket.resetTime)}{!['5h', 'weekly'].includes(quotaBucketKey(bucket)) ? ` · 剩余 ${Math.round(bucket.remainingFraction * 100)}%` : ''}</dd></div>))}
      </dl>
      {canEdit ? <div className="account-detail-actions">
        <button className="btn ghost small" type="button" onClick={onRecheck} disabled={recheckBlocked || toggling || !account.enabled}>{checking ? '检测中…' : '重检'}</button>
        <button className="btn danger small" type="button" onClick={onDelete} disabled={toggling || checking}>删除账号</button>
      </div> : null}
    </section> : null}
  </article>;
}
