import { fmtCompact, fmtNumber } from '@/lib/format';
export function CompactNumber({ value }: { value: number | null | undefined }) {
  return <span title={value == null ? '未采集' : fmtNumber(value)}>{value == null ? '—' : fmtCompact(value)}</span>;
}
