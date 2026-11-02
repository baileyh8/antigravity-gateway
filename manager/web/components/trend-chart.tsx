'use client';

import { fmtCompact } from '@/lib/format';
import { smoothPath } from '@/lib/chart-path';
import { ChartTooltip, dateLabel, useChartSelection } from './chart-interaction';
import type { TrendPoint } from '@/lib/types';

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const ratio = value / base;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 10].find((candidate) => ratio <= candidate) || 10;
  return step * base;
}


export function TrendChart({ points }: { points: TrendPoint[] }) {
  const { activeIndex, setActiveIndex, containerRef, leave } = useChartSelection();
  const data = points.length ? points : [];
  if (!data.length) {
    return <div className="muted small" style={{ padding: '60px 0', textAlign: 'center' }}>暂无用量数据</div>;
  }

  const width = 760;
  const height = 220;
  const left = 40;
  const right = 20;
  const top = 20;
  const bottom = 180;
  const plotW = width - left - right;
  const plotH = bottom - top;
  const maxTokens = Math.max(1, ...data.map((point) => point.tokens));
  const axisMax = niceCeil(maxTokens);
  const maxRequests = Math.max(1, ...data.map((point) => point.requests));
  const step = data.length > 1 ? plotW / (data.length - 1) : plotW;
  const x = (index: number) => left + index * step;
  const y = (value: number) => bottom - (value / axisMax) * (plotH - 10);
  const line = smoothPath(data.map((point, index) => ({ x: x(index), y: y(point.tokens) })));
  const active = activeIndex === null ? null : data[activeIndex];
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${bottom} L${x(0).toFixed(1)} ${bottom} Z`;
  const labelIndexes = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.map((_, index) => index);

  return (
    <div ref={containerRef} className="chart-interactive" onPointerLeave={leave}><svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="调用趋势">
      <title>调用趋势</title>
      <g stroke="rgba(24,24,27,.06)" strokeWidth="1">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = top + ratio * (plotH - 10);
          return <line key={ratio} x1={left} y1={lineY} x2={width - right} y2={lineY} />;
        })}
      </g>
      <g className="axis">
        {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
          <text key={ratio} x={4} y={top + (1 - ratio) * (plotH - 10) + 4}>
            {ratio === 0 ? '0' : fmtCompact(axisMax * ratio)}
          </text>
        ))}
      </g>
      <g fill="rgba(24,24,27,.09)">
        {data.map((point, index) => {
          const barHeight = Math.max(2, (point.requests / maxRequests) * 70);
          return <rect key={point.date} x={x(index) - 4} y={bottom - barHeight} width="8" height={barHeight} rx="2" />;
        })}
      </g>
      <path d={area} fill="rgba(24,24,27,.035)" />
      <path data-curve="tokens" d={line} fill="none" stroke="#18181b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].tokens)} r="3" fill="#fff" stroke="#18181b" strokeWidth="1.6" />
      {active && activeIndex !== null ? <g pointerEvents="none"><line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={bottom} stroke="#71717a" strokeDasharray="3 4" opacity=".5" /><circle cx={x(activeIndex)} cy={y(active.tokens)} r={3.5} fill="#fff" stroke="#18181b" strokeWidth={1.6} /></g> : null}
      {data.map((point, i) => <rect key={`hit-${point.date}`} className="chart-hit" x={Math.max(left, x(i) - step / 2)} y={top} width={data.length === 1 ? plotW : i === 0 || i === data.length - 1 ? step / 2 : step} height={height - top} fill="transparent" tabIndex={0} aria-label={`${dateLabel(point.date)}：${point.tokens} Token，${point.requests} 个请求`} onPointerEnter={e => { if (e.pointerType === 'mouse') setActiveIndex(i); }} onPointerMove={e => { if (e.pointerType === 'mouse') setActiveIndex(i); }} onPointerDown={() => setActiveIndex(i)} onFocus={() => setActiveIndex(i)} />)}
      <g className="axis" pointerEvents="none">
        {labelIndexes.map((index) => (
          <text
            key={data[index].date}
            x={x(index)}
            y={height - 12}
            textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
          >
            {data[index].date.slice(5)}
          </text>
        ))}
      </g>
    </svg>{active ? <ChartTooltip point={active} onClose={() => setActiveIndex(null)} /> : null}</div>
  );
}
