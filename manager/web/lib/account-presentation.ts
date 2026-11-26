import type { Account, Quota } from './types';

export type HealthPresentation = { key: string; label: string; tone: string };

export function accountHealth(account: Account): HealthPresentation {
  const evidence = `${account.healthReason || ''} ${account.healthMessage || ''} ${account.lastError || ''}`;
  if (/TOS[_ -]?VIOLATION|\bterms\s+of\s+service\b|违反.{0,8}(服务)?条款|条款违规/i.test(evidence)) {
    return { key: 'tos', label: 'TOS', tone: 'red' };
  }
  const newerSuccess = Date.parse(account.lastSuccessAt || '') > Date.parse(account.healthCheckedAt || '');
  if (!newerSuccess && account.healthCheckStatus === 'rate_limited') return { key: 'cooldown', label: '限流（429）', tone: 'amber' };
  if (!newerSuccess && account.healthCheckStatus === 'unknown') return { key: 'unknown', label: '待核验', tone: '' };
  const state = account.healthState && account.healthState !== 'available' ? account.healthState : account.state;
  if (state === 'verification_required') return { key: 'error', label: '需核验', tone: 'amber' };
  if (state === 'authentication_error') return { key: 'error', label: '凭据失效', tone: 'red' };
  if (state === 'access_denied' || account.healthReason === 'account_access_denied') return { key: 'error', label: '访问受限', tone: 'red' };
  if (state === 'cooldown') return { key: 'cooldown', label: '冷却', tone: 'amber' };
  if (state === 'available' || (state === 'disabled' && account.healthState === 'available' && account.lastSuccessAt)) {
    return { key: 'healthy', label: '健康', tone: 'green' };
  }
  if (state === 'disabled' || state === 'unknown') return { key: 'unknown', label: '待核验', tone: '' };
  return { key: 'error', label: '异常', tone: 'red' };
}

export function accountPlan(account: Account): string {
  const plan = account.quota?.plan || account.planName || '';
  if (/^(g1-ultra-tier|ultra)$/i.test(plan)) return 'Google AI Ultra';
  if (/^(g1-pro-tier|pro)$/i.test(plan)) return 'Google AI Pro';
  if (/^(free-tier|free|starter)$/i.test(plan)) return 'Starter · 免费';
  return plan || '套餐待核验';
}

export function quotaIsStale(quota: Quota, now = Date.now()): boolean {
  return Boolean(quota && (quota.stale || (quota.expiresAt && Date.parse(quota.expiresAt) <= now)));
}

export function matchesAccountFilter(account: Account, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'enabled') return account.enabled;
  if (filter === 'disabled') return !account.enabled;
  return accountHealth(account).key === filter;
}

export function resetTimeLabel(value: string, now = Date.now()): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '重置时间未知';
  const diff = time - now;
  if (diff <= 0) return '已到重置时间，待刷新';
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟后重置`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}后重置`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时后重置`;
}
