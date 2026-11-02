const compactDecimals = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

export function fmtNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

export function fmtCompact(value: number | null | undefined): string {
  const number = Number(value) || 0;
  if (!Number.isFinite(number)) return '0';
  const abs = Math.abs(number);
  const units = [{factor: 1e9, suffix: 'B'}, {factor: 1e6, suffix: 'M'}, {factor: 1e3, suffix: 'K'}];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (abs < unit.factor) continue;
    if (i > 0 && Number(compactDecimals.format(abs / unit.factor)) >= 1000) return `${compactDecimals.format(number / units[i - 1].factor)}${units[i - 1].suffix}`;
    return `${compactDecimals.format(number / unit.factor)}${unit.suffix}`;
  }
  return fmtNumber(number);
}

export function fmtPercent(value: number | null | undefined, digits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number.toFixed(digits)}%`;
}

export function fmtUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (total < 60) return '刚刚启动';
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

export function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function fmtRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '—';
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

export function fmtBytes(value: number | null | undefined): string {
  const number = Number(value) || 0;
  if (number >= 1024 ** 3) return `${(number / 1024 ** 3).toFixed(1)} GB`;
  if (number >= 1024 ** 2) return `${Math.round(number / 1024 ** 2)} MB`;
  if (number >= 1024) return `${Math.round(number / 1024)} KB`;
  return `${number} B`;
}
