import type { Account, QuotaBucket, QuotaGroup } from './types';

export type QuotaKind = 'gemini' | 'claude' | 'argon' | 'other';

export type QuotaCell = {
  key: string;
  kind: QuotaKind;
  groupLabel: string;
  bucketKey: string;
  bucketLabel: string;
  fraction: number;
  resetTime: string;
};

export const QUOTA_KINDS: Array<{ kind: QuotaKind; label: string }> = [
  { kind: 'gemini', label: 'Gemini' },
  { kind: 'claude', label: 'Claude / GPT' },
  { kind: 'argon', label: 'Argon' }
];

export function quotaKind(group: QuotaGroup): QuotaKind {
  const raw = `${group.displayName || ''} ${group.description || ''}`.toLowerCase();
  if (raw.includes('argon')) return 'argon';
  if (raw.includes('claude') || raw.includes('gpt')) return 'claude';
  if (raw.includes('gemini')) return 'gemini';
  return 'other';
}

export function quotaGroupLabel(group: QuotaGroup): string {
  const kind = quotaKind(group);
  if (kind === 'gemini') return 'Gemini';
  if (kind === 'claude') return 'Claude / GPT';
  if (kind === 'argon') return 'Argon';
  return group.displayName || '其他';
}

export function quotaBucketKey(bucket: QuotaBucket): string {
  const raw = `${bucket.window || ''} ${bucket.displayName || ''}`.toLowerCase();
  if (raw.includes('week')) return 'weekly';
  if (raw.includes('5h') || raw.includes('five hour') || raw.includes('5 hour')) return '5h';
  if (raw.includes('day')) return 'daily';
  if (raw.includes('month')) return 'monthly';
  return 'other';
}

export function quotaBucketLabel(bucket: QuotaBucket): string {
  const key = quotaBucketKey(bucket);
  if (key === 'weekly') return '周';
  if (key === '5h') return '5h';
  if (key === 'daily') return '日';
  if (key === 'monthly') return '月';
  return bucket.displayName || bucket.window || '额度';
}

export function quotaCells(account: Account): QuotaCell[] {
  const groups = account.quota?.groups || [];
  return groups.flatMap((group) => (group.buckets || []).map((bucket) => ({
    key: `${group.id}-${bucket.id}`,
    kind: quotaKind(group),
    groupLabel: quotaGroupLabel(group),
    bucketKey: quotaBucketKey(bucket),
    bucketLabel: quotaBucketLabel(bucket),
    fraction: bucket.remainingFraction,
    resetTime: bucket.resetTime
  })));
}

export function lowestByKind(account: Account): Partial<Record<QuotaKind, QuotaCell>> {
  const output: Partial<Record<QuotaKind, QuotaCell>> = {};
  for (const cell of quotaCells(account)) {
    const current = output[cell.kind];
    if (!current || cell.fraction < current.fraction) output[cell.kind] = cell;
  }
  return output;
}

export function quotaMatrix(account: Account) {
  const cells = quotaCells(account);
  const pick = (kind: QuotaKind, bucketKey: string) => cells.find((cell) => cell.kind === kind && cell.bucketKey === bucketKey) || null;
  return {
    gemini5h: pick('gemini', '5h'),
    geminiWeek: pick('gemini', 'weekly'),
    claude5h: pick('claude', '5h'),
    claudeWeek: pick('claude', 'weekly'),
    argonWeek: pick('argon', 'weekly')
  };
}

export function lowestOverall(account: Account): QuotaCell | null {
  const cells = quotaCells(account);
  if (!cells.length) return null;
  return cells.reduce((lowest, cell) => cell.fraction < lowest.fraction ? cell : lowest, cells[0]);
}

export function poolSummary(accounts: Account[]) {
  return QUOTA_KINDS.map(({ kind, label }) => {
    let best: { account: Account; cell: QuotaCell } | null = null;
    let below20 = 0;
    for (const account of accounts) {
      const cell = lowestByKind(account)[kind];
      if (!cell) continue;
      if (cell.fraction < 0.2) below20 += 1;
      if (!best || cell.fraction < best.cell.fraction) best = { account, cell };
    }
    return { kind, label, best, below20 };
  });
}
