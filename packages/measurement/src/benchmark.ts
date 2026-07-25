import type {
  Calibration,
  CalibrationTarget,
  Correction,
  FeatureVector,
} from "../../contracts/src";

export interface RelativeCalibrationInterval {
  startSeconds: number;
  endSeconds: number;
  target: CalibrationTarget;
}

export interface RelativeEvaluationInterval {
  startSeconds: number;
  endSeconds: number;
  label: Correction["label"];
  note?: string;
}

const inInterval = (
  timestampUs: number,
  originUs: number,
  startSeconds: number,
  endSeconds: number,
) => {
  const relativeUs = timestampUs - originUs;
  return (
    relativeUs >= Math.round(startSeconds * 1_000_000) &&
    relativeUs < Math.round(endSeconds * 1_000_000)
  );
};

export function calibrationSamplesFromIntervals(
  features: FeatureVector[],
  originUs: number,
  intervals: RelativeCalibrationInterval[],
): Calibration["samples"] {
  return intervals.flatMap((interval) =>
    features
      .filter((feature) =>
        inInterval(
          feature.timestampUs,
          originUs,
          interval.startSeconds,
          interval.endSeconds,
        ),
      )
      .map((feature) => ({ target: interval.target, feature })),
  );
}

export function correctionsFromIntervals(
  sessionId: string,
  originUs: number,
  intervals: RelativeEvaluationInterval[],
): Correction[] {
  return intervals.map((interval, index) => ({
    id: `benchmark-label-${index}`,
    sessionId,
    startUs: originUs + Math.round(interval.startSeconds * 1_000_000),
    endUs: originUs + Math.round(interval.endSeconds * 1_000_000),
    label: interval.label,
    createdAt: new Date(0).toISOString(),
    note: interval.note,
  }));
}

const quantile = (values: number[], position: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.ceil((sorted.length - 1) * position)];
};

export function summarizeTrackerFeatures(features: FeatureVector[]) {
  const detected = features.filter((feature) => feature.faceDetected);
  const usable = detected.filter(
    (feature) => !feature.blink && feature.confidence >= 0.55,
  );
  const latencies = features
    .map((feature) => feature.analysisLatencyMs)
    .filter((value): value is number => value !== undefined);
  return {
    frames: features.length,
    detectionRate: detected.length / Math.max(1, features.length),
    usableRate: usable.length / Math.max(1, features.length),
    blinkFrames: features.filter((feature) => feature.blink).length,
    medianLatencyMs: quantile(latencies, 0.5),
    p95LatencyMs: quantile(latencies, 0.95),
  };
}

const vectorDelta = (
  first: FeatureVector,
  second: FeatureVector,
  yaw: "eyeYaw" | "headYaw",
  pitch: "eyePitch" | "headPitch",
) => Math.hypot(second[yaw] - first[yaw], second[pitch] - first[pitch]);

export function summarizeCalibrationStability(
  features: FeatureVector[],
  originUs: number,
  intervals: RelativeCalibrationInterval[],
) {
  return intervals.map((interval) => {
    const values = features.filter(
      (feature) =>
        inInterval(
          feature.timestampUs,
          originUs,
          interval.startSeconds,
          interval.endSeconds,
        ) &&
        feature.faceDetected &&
        !feature.blink &&
        feature.confidence >= 0.55,
    );
    const eyeDeltas = values
      .slice(1)
      .map((value, index) =>
        vectorDelta(values[index], value, "eyeYaw", "eyePitch"),
      );
    const headDeltas = values
      .slice(1)
      .map((value, index) =>
        vectorDelta(values[index], value, "headYaw", "headPitch"),
      );
    const faceScales = values.map((value) => value.faceScale);
    const meanFaceScale =
      faceScales.reduce((sum, value) => sum + value, 0) /
      Math.max(1, faceScales.length);
    const faceScaleStandardDeviation = Math.sqrt(
      faceScales.reduce(
        (sum, value) => sum + (value - meanFaceScale) ** 2,
        0,
      ) / Math.max(1, faceScales.length),
    );
    return {
      target: interval.target,
      startSeconds: interval.startSeconds,
      endSeconds: interval.endSeconds,
      usableFrames: values.length,
      medianEyeJitter: quantile(eyeDeltas, 0.5),
      p95EyeJitter: quantile(eyeDeltas, 0.95),
      medianHeadJitter: quantile(headDeltas, 0.5),
      p95HeadJitter: quantile(headDeltas, 0.95),
      faceScaleCoefficientOfVariation: meanFaceScale
        ? faceScaleStandardDeviation / meanFaceScale
        : 0,
    };
  });
}
