const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function isBilateralBlink({
  leftBlendshape,
  rightBlendshape,
  leftEyeOpen,
  rightEyeOpen,
}: {
  leftBlendshape: number;
  rightBlendshape: number;
  leftEyeOpen: number;
  rightEyeOpen: number;
}): boolean {
  return (
    (leftBlendshape > 0.58 && rightBlendshape > 0.58) ||
    (leftEyeOpen < 0.018 && rightEyeOpen < 0.018)
  );
}

export function geometricTrackingConfidence({
  faceScale,
  leftYaw,
  rightYaw,
  leftPitch,
  rightPitch,
}: {
  faceScale: number;
  leftYaw: number;
  rightYaw: number;
  leftPitch: number;
  rightPitch: number;
}): number {
  // MediaPipe has already applied its configured 0.55 detection/presence/tracking
  // gates by the time a complete landmark set reaches this function. Use scale
  // and anatomical plausibility to distinguish a clean landmark fit from a
  // marginal one without requiring the speaker to sit unnaturally close.
  const scaleQuality = clamp01((faceScale - 0.06) / 0.1);
  const largestNormalizedIrisOffset = Math.max(
    Math.abs(leftYaw),
    Math.abs(rightYaw),
    Math.abs(leftPitch),
    Math.abs(rightPitch),
  );
  const geometryQuality = clamp01(1 - Math.max(0, largestNormalizedIrisOffset - 1.25) / 0.5);
  const interEyeDisagreement = Math.max(
    Math.abs(leftYaw - rightYaw),
    Math.abs(leftPitch - rightPitch),
  );
  const agreementQuality = clamp01(
    1 - Math.max(0, interEyeDisagreement - 0.45) / 0.55,
  );
  return clamp01(
    0.45 + 0.5 * Math.min(scaleQuality, geometryQuality, agreementQuality),
  );
}
