import type { Account } from '@/lib/types';
import { QUOTA_KINDS, lowestByKind } from '@/lib/quota';

export function QuotaChips({ account }: { account: Account }) {
  const lowest = lowestByKind(account);
  return (
    <div className="quota-chips" aria-label="模型组额度">
      {QUOTA_KINDS.map(({ kind, label }) => {
        const cell = lowest[kind];
        const percent = cell ? Math.round(cell.fraction * 100) : null;
        const tone = percent == null ? 'missing' : percent < 20 ? 'low' : percent < 50 ? 'warn' : '';
        const short = label === 'Claude / GPT' ? 'C' : label === 'Gemini' ? 'G' : 'A';
        const title = cell ? `${label} · ${cell.bucketLabel}最低 ${percent}%` : `${label} · 无额度数据`;
        return (
          <span className={`quota-chip ${tone}`} key={kind} title={title}>
            <i>{short}</i><b>{percent == null ? '—' : `${percent}%`}</b>
          </span>
        );
      })}
    </div>
  );
}
