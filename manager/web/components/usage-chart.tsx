'use client';
import { useState } from 'react';
import { smoothPath } from '@/lib/chart-path';
import { ChartTooltip, dateLabel, useChartSelection } from './chart-interaction';
import { fmtCompact, fmtNumber } from '@/lib/format';
import type { TrendPoint } from '@/lib/types';

export type UsagePoint = TrendPoint & { groups: Record<string, number> };
const COLORS = ['#374151', '#6478aa', '#5e938a', '#9380ab', '#b29b67', '#d1d5db'];
export function UsageChart({ points, series, grain, timezone }: { points: UsagePoint[]; series: Array<{ id: string; name: string }>; grain: string; timezone?: string }) {
  const { activeIndex, setActiveIndex, containerRef, leave } = useChartSelection();
  const [hidden, setHidden] = useState<string[]>([]);
  if (!points.length) return <p className="muted" style={{ padding: 40, textAlign: 'center' }}>暂无用量数据</p>;
  const shown = series.filter(s => !hidden.includes(s.id));
  const left = 48, right = 710, top = 16, bottom = 180;
  const w = (right - left) / points.length;
  const max = Math.max(1, ...points.map(p => shown.reduce((n, s) => n + (p.groups[s.id] || 0), 0))) * 1.08;
  const requests = Math.max(1, ...points.map(p => p.requests));
  const barWidth = Math.min(8, Math.max(1, w * .32));
  const y = (n: number) => bottom - n / max * (bottom - top);
  const x = (i: number) => left + (i + 0.5) * w;
  const label = (date: string) => grain === 'hour' ? new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }) : date.slice(5);
  const indexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const active = activeIndex === null ? null : points[activeIndex];
  return <div ref={containerRef} className="chart-interactive" onPointerLeave={leave}>
    <div className="usage-legend">{series.map((s, i) => <button key={s.id} className={hidden.includes(s.id) ? 'off' : ''} title={s.name} aria-pressed={!hidden.includes(s.id)} onClick={() => setHidden(old => old.includes(s.id) ? old.filter(v => v !== s.id) : [...old, s.id])}><span style={{ background: COLORS[i % COLORS.length] }} />{s.name}</button>)}<span className="muted tiny">点击图例切换系列 · 黑线为请求数（右轴）</span></div>
    <svg className="chart usage-chart" viewBox="0 0 760 220" role="img" aria-label="按分组堆叠的 Token 趋势和客户端请求数">
      <title>Token 堆叠柱与客户端请求折线；悬停查看每格明细</title>
      {[0, .25, .5, .75, 1].map(r => <g key={r}><line x1={left} x2={right} y1={y(max * r)} y2={y(max * r)} stroke="rgba(24,24,27,.06)" /><text className="axis" x={4} y={y(max * r) + 4}>{fmtCompact(max * r)}</text></g>)}
      <text className="axis" x={right + 8} y={top + 4}>{fmtCompact(requests)} 次</text><text className="axis" x={right + 8} y={bottom}>0</text>
      {points.map((point, i) => {
        let accumulated = 0;
        return <g key={point.date}>{shown.map(s => {
          const value = point.groups[s.id] || 0;
          const before = accumulated; accumulated += value;
          return <rect key={s.id} x={x(i) - barWidth / 2} y={y(accumulated)} width={barWidth} height={Math.max(0, y(before) - y(accumulated))} fill={COLORS[series.findIndex(v => v.id === s.id) % COLORS.length]} opacity={active && activeIndex !== i ? .5 : .9} />;
        })}</g>;
      })}
      <path data-curve="requests" d={smoothPath(points.map((p, i) => ({ x: x(i), y: bottom - p.requests / requests * (bottom - top) })))} fill="none" stroke="#18181b" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
      {active && activeIndex !== null ? <g pointerEvents="none"><line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={bottom} stroke="#71717a" strokeDasharray="3 4" opacity=".5" /><circle cx={x(activeIndex)} cy={bottom - active.requests / requests * (bottom - top)} r={3.5} fill="#fff" stroke="#18181b" strokeWidth={1.6} /></g> : null}
      {points.map((point, i) => <rect key={`hit-${point.date}`} className="chart-hit" x={left + i * w} y={top} width={w} height={220 - top} fill="transparent" tabIndex={0} aria-label={`${dateLabel(point.date, timezone)}：${fmtNumber(point.tokens)} Token，${fmtNumber(point.requests)} 个请求`} onPointerEnter={e => { if (e.pointerType === 'mouse') setActiveIndex(i); }} onPointerMove={e => { if (e.pointerType === 'mouse') setActiveIndex(i); }} onPointerDown={() => setActiveIndex(i)} onFocus={() => setActiveIndex(i)} />)}
      {indexes.map(i => <text key={i} className="axis" pointerEvents="none" x={x(i)} y={208} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{label(points[i].date)}</text>)}
    </svg>
    {active ? <ChartTooltip point={active} timezone={timezone} onClose={() => setActiveIndex(null)} rows={series.map((s, i) => ({ id: s.id, name: s.name, value: active.groups[s.id] || 0, color: COLORS[i % COLORS.length] }))} /> : null}
  </div>;
}
