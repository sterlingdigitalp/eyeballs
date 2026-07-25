export function rmsDbfs(samples: Float32Array): number {
  if (!samples.length) return -120;
  const meanSquare =
    samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length;
  if (meanSquare <= 0) return -120;
  return Math.max(-120, Math.min(0, 20 * Math.log10(Math.sqrt(meanSquare))));
}

export function audioMeterPercent(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
}
