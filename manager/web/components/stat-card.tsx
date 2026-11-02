import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  hint,
  icon,
  hintTone
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  hintTone?: 'warn' | 'bad';
}) {
  return (
    <div className="card">
      <div className="stat-label"><span>{label}</span>{icon}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className={`stat-hint${hintTone ? ` ${hintTone}` : ''}`}>{hint}</div> : null}
    </div>
  );
}
