export type ChartCoordinate = { x: number; y: number };

// Monotone cubic interpolation passes through every recorded point without
// introducing peaks or negative values between adjacent observations.
export function smoothPath(points: ChartCoordinate[]): string {
  if (!points.length) return '';
  const fmt = (n: number) => Number(n.toFixed(3));
  const start = `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
  if (points.length === 1) return start;
  const slopes = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x));
  const tangent = points.map((_, i) => {
    if (!i) return slopes[0];
    if (i === points.length - 1) return slopes[i - 1];
    const a = slopes[i - 1], b = slopes[i];
    if (a * b <= 0) return 0;
    const h0 = points[i].x - points[i - 1].x, h1 = points[i + 1].x - points[i].x;
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / a + w2 / b);
  });
  return start + points.slice(1).map((p, i) => {
    const previous = points[i], h = (p.x - previous.x) / 3;
    return ` C${fmt(previous.x + h)} ${fmt(previous.y + tangent[i] * h)} ${fmt(p.x - h)} ${fmt(p.y - tangent[i + 1] * h)} ${fmt(p.x)} ${fmt(p.y)}`;
  }).join('');
}
