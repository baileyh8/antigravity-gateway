import type { QuotaCell } from '@/lib/quota';

export function QuotaCellView({ cell }: { cell: QuotaCell | null }) {
  if (!cell) return <span className="muted tiny">—</span>;
  const percent = Math.round(cell.fraction * 100);
  const tone = percent < 20 ? 'red' : percent < 50 ? 'amber' : 'green';
  return (
    <div className="quota-cell" title={`${cell.groupLabel} · ${cell.bucketLabel} · ${percent}%`}>
      <div className="quota-cell-top"><span>{percent}%</span><span className="muted">{cell.bucketLabel}</span></div>
      <div className="bar"><i className={tone} style={{ width: `${Math.max(2, percent)}%` }} /></div>
    </div>
  );
}

function QuotaLine({ label, cell }: { label: string; cell: QuotaCell | null }) {
  const percent = cell ? Math.round(cell.fraction * 100) : null;
  const tone = percent == null ? '' : percent < 20 ? 'red' : percent < 50 ? 'amber' : 'green';
  return (
    <div className="quota-line" title={cell ? `${cell.groupLabel} · ${cell.bucketLabel} · ${percent}%` : `${label} 无数据`}>
      <span className="quota-line-label">{label}</span>
      <div className="bar"><i className={tone} style={{ width: percent == null ? 0 : `${Math.max(2, percent)}%` }} /></div>
      <b>{percent == null ? '—' : `${percent}%`}</b>
    </div>
  );
}

export function QuotaGroupCell({ fiveHour, weekly }: { fiveHour: QuotaCell | null; weekly: QuotaCell | null }) {
  return (
    <div className="quota-stack">
      <QuotaLine label="5h" cell={fiveHour} />
      <QuotaLine label="周" cell={weekly} />
    </div>
  );
}

export function QuotaLowest({ cell }: { cell: QuotaCell | null }) {
  if (!cell) return <span className="muted tiny">—</span>;
  const percent = Math.round(cell.fraction * 100);
  return (
    <div className="quota-lowest" title={`${cell.groupLabel} · ${cell.bucketLabel} · ${percent}%`}>
      <span>{cell.groupLabel}</span><b>{percent}%</b><small>{cell.bucketLabel}</small>
    </div>
  );
}
