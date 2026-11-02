'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { CompactNumber } from './compact-number';
import { fmtNumber, fmtPercent } from '@/lib/format';
import type { TrendPoint } from '@/lib/types';

export function useChartSelection() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const open = activeIndex !== null;
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => { if (!containerRef.current?.contains(event.target as Node)) setActiveIndex(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveIndex(null); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, [open]);
  return { activeIndex, setActiveIndex, containerRef, leave: (event: PointerEvent) => { if (event.pointerType === 'mouse') setActiveIndex(null); } };
}

export function dateLabel(value: string, timezone?: string) {
  return value.length === 10 ? value : new Date(value).toLocaleString('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function ChartTooltip({ point, rows = [], timezone, onClose }: { point: TrendPoint; rows?: Array<{ id?: string; name: string; value: number; color: string }>; timezone?: string; onClose: () => void }) {
  return <div className="chart-tooltip" role="status" aria-live="polite">
    <div className="chart-tooltip-head"><strong>{dateLabel(point.date, timezone)}</strong><button type="button" onClick={onClose} aria-label="关闭图表数据">×</button></div>
    <dl><div><dt>总 Token</dt><dd><CompactNumber value={point.tokens} /></dd></div><div><dt>客户端请求</dt><dd><CompactNumber value={point.requests} /></dd></div><div><dt>输入 / 输出</dt><dd><CompactNumber value={point.inputTokens} /> / <CompactNumber value={point.outputTokens} /></dd></div><div><dt>缓存读取 / 命中</dt><dd><CompactNumber value={point.cachedTokens} /> / {point.inputTokens ? fmtPercent(point.cachedTokens / point.inputTokens * 100, 1) : '—'}</dd></div></dl>
    {rows.length ? <div className="chart-tooltip-series">{rows.map(row => <div key={row.id || row.name}><span title={row.name}><i style={{ background: row.color }} />{row.name}</span><b><CompactNumber value={row.value} /></b></div>)}</div> : null}
  </div>;
}
