export interface SparklinePoint {
  x: number;
  y: number;
}

/** Normalize a numeric series into a stable SVG viewport. */
export function sparklinePoints(
  values: readonly number[],
  width = 120,
  height = 32,
  padding = 2,
): SparklinePoint[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const usableWidth = Math.max(0, width - padding * 2);
  const usableHeight = Math.max(0, height - padding * 2);
  return values.map((value, index) => ({
    x:
      values.length === 1
        ? width / 2
        : padding + (index / (values.length - 1)) * usableWidth,
    y:
      range === 0
        ? height / 2
        : padding + (1 - (value - min) / range) * usableHeight,
  }));
}

export function sparklinePolyline(points: readonly SparklinePoint[]): string {
  return points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
}
