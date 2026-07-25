import type {
  Calibration,
  CalibrationTarget,
  CaptureProfile,
  FeatureVector,
} from "../../contracts/src";
import { classifyFrame, trainClassifier } from "./classifier";

export function isCalibrationContactTarget(target: CalibrationTarget): boolean {
  return (
    target === "lens" ||
    target === "near_lens" ||
    target === "head_left_eyes_lens" ||
    target === "head_right_eyes_lens" ||
    target === "head_down_eyes_lens"
  );
}

export function isCalibrationContactState(state: string): boolean {
  return state === "contact" || state === "near_lens";
}

export function calibrationFingerprint(profile: CaptureProfile): Calibration["setupFingerprint"] {
  const video = profile.negotiatedVideo ?? profile.requestedVideo;
  return {
    cameraDeviceId: profile.cameraDeviceId,
    width: video.width,
    height: video.height,
    frameRate: video.frameRate,
    lensAnchorX: profile.lensAnchor.x,
    lensAnchorY: profile.lensAnchor.y,
  };
}

export function calibrationInvalidationReason(
  calibration: Calibration,
  profile: CaptureProfile,
  trackerId: string,
  trackerVersion: string,
  algorithmVersion?: string,
): string | undefined {
  if (calibration.invalidatedAt) return calibration.invalidationReason ?? "Calibration was invalidated.";
  if (calibration.trackerId !== trackerId || calibration.trackerVersion !== trackerVersion) {
    return "Tracking provider or model changed.";
  }
  if (algorithmVersion && calibration.algorithmVersion !== algorithmVersion) {
    return "Classifier algorithm changed.";
  }
  const expected = calibration.setupFingerprint;
  const actual = calibrationFingerprint(profile);
  if (expected.cameraDeviceId !== actual.cameraDeviceId) return "Camera changed.";
  if (expected.width !== actual.width || expected.height !== actual.height) return "Resolution or crop changed.";
  if (Math.abs(expected.frameRate - actual.frameRate) > 1) return "Frame rate changed.";
  if (
    Math.abs(expected.lensAnchorX - actual.lensAnchorX) > 0.01 ||
    Math.abs(expected.lensAnchorY - actual.lensAnchorY) > 0.01
  ) return "Lens anchor changed.";
  return undefined;
}

export function selectActiveCalibration(
  calibrations: Calibration[],
  profile: CaptureProfile | undefined,
  trackerId: string,
  trackerVersion: string,
  algorithmVersion?: string,
): Calibration | undefined {
  if (!profile) return undefined;
  return calibrations
    .filter(
      (calibration) =>
        calibration.profileId === profile.id &&
        !calibrationInvalidationReason(
          calibration,
          profile,
          trackerId,
          trackerVersion,
          algorithmVersion,
        ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function scoreCalibration(samples: FeatureVector[]): {
  score: number;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (samples.length < 40) warnings.push("Collect at least 40 stable samples.");
  const usable = samples.filter((sample) => sample.faceDetected && !sample.blink && sample.confidence >= 0.65);
  const usableRatio = usable.length / Math.max(1, samples.length);
  if (usableRatio < 0.8) warnings.push("Face tracking was unstable; improve lighting or framing.");
  const range = (values: number[]) =>
    values.length ? Math.max(...values) - Math.min(...values) : 0;
  const yawRange = range(usable.map((sample) => sample.eyeYaw));
  const pitchRange = range(usable.map((sample) => sample.eyePitch));
  if (yawRange < 0.08 || pitchRange < 0.05) warnings.push("Targets did not produce enough gaze variation.");
  return {
    score: Math.max(0, Math.min(1, usableRatio * (warnings.length ? 0.75 : 1))),
    warnings,
  };
}

export function evaluateHeldOutCalibration(calibration: Calibration): {
  accuracy: number;
  trainingSamples: Calibration["samples"];
  validationSamples: Calibration["samples"];
  byTarget: Record<string, { correct: number; evaluated: number; accuracy: number }>;
} {
  let trainingSamples: Calibration["samples"];
  let validationSamples: Calibration["samples"];
  if (calibration.validationSamples?.length) {
    trainingSamples = calibration.samples;
    validationSamples = calibration.validationSamples;
  } else {
    const counts = new Map<string, number>();
    trainingSamples = [];
    validationSamples = [];
    for (const sample of calibration.samples) {
      const index = counts.get(sample.target) ?? 0;
      counts.set(sample.target, index + 1);
      (index % 5 === 4 ? validationSamples : trainingSamples).push(sample);
    }
  }
  if (!validationSamples.length) {
    return { accuracy: 0, trainingSamples, validationSamples, byTarget: {} };
  }
  const model = trainClassifier({ ...calibration, samples: trainingSamples });
  let correct = 0;
  let evaluated = 0;
  const byTarget = new Map<CalibrationTarget, { correct: number; evaluated: number }>();
  for (const sample of validationSamples) {
    if (sample.feature.blink || !sample.feature.faceDetected || sample.feature.confidence < 0.55) continue;
    const predicted = classifyFrame(model, sample.feature).rawState;
    const expectedContact = isCalibrationContactTarget(sample.target);
    const predictedContact = isCalibrationContactState(predicted);
    const target = byTarget.get(sample.target) ?? { correct: 0, evaluated: 0 };
    evaluated += 1;
    target.evaluated += 1;
    if (predicted !== "unknown" && expectedContact === predictedContact) {
      correct += 1;
      target.correct += 1;
    }
    byTarget.set(sample.target, target);
  }
  return {
    accuracy: evaluated ? correct / evaluated : 0,
    trainingSamples,
    validationSamples,
    byTarget: Object.fromEntries([...byTarget.entries()].map(([target, value]) => [
      target,
      {
        ...value,
        accuracy: value.evaluated ? value.correct / value.evaluated : 0,
      },
    ])),
  };
}

export interface CalibrationGateResult {
  accepted: boolean;
  reasons: string[];
}

export function calibrationQualityGate(
  heldOutAccuracy: number,
  byTarget: Record<string, { correct: number; evaluated: number; accuracy: number }>,
  requiredTargets: readonly CalibrationTarget[] = Object.keys(byTarget) as CalibrationTarget[],
): CalibrationGateResult {
  const reasons: string[] = [];
  if (heldOutAccuracy < 0.85) {
    reasons.push(
      `Overall held-out agreement was ${Math.round(heldOutAccuracy * 100)}%; 85% is required.`,
    );
  }
  const lens = byTarget.lens;
  if (!lens || lens.evaluated < 5) {
    reasons.push("Hidden validation needs at least five usable physical-lens samples.");
  } else if (lens.accuracy < 0.8) {
    reasons.push(
      `Physical-lens agreement was ${Math.round(lens.accuracy * 100)}%; 80% is required.`,
    );
  }
  for (const target of new Set(requiredTargets)) {
    if (target === "lens") continue;
    const result = byTarget[target];
    if (!result || result.evaluated < 5) {
      reasons.push(
        `${target} needs at least five usable hidden-validation samples.`,
      );
    } else if (result.accuracy < 0.7) {
      reasons.push(
        `${target} agreement was ${Math.round(result.accuracy * 100)}%; every target needs at least 70%.`,
      );
    }
  }
  return { accepted: reasons.length === 0, reasons };
}

export function scoreCalibrationTargets(
  samples: Calibration["samples"],
): Record<string, { score: number; usableRatio: number; warnings: string[] }> {
  const grouped = new Map<CalibrationTarget, FeatureVector[]>();
  for (const sample of samples) {
    grouped.set(sample.target, [...(grouped.get(sample.target) ?? []), sample.feature]);
  }
  return Object.fromEntries([...grouped.entries()].map(([target, values]) => {
    const usable = values.filter((value) => value.faceDetected && !value.blink && value.confidence >= 0.65);
    const usableRatio = usable.length / Math.max(1, values.length);
    const percentile = (
      feature: keyof Pick<FeatureVector, "eyeYaw" | "eyePitch" | "headYaw" | "headPitch">,
      position: number,
    ) => {
      const sorted = usable.map((value) => value[feature]).sort((a, b) => a - b);
      if (!sorted.length) return 0;
      return sorted[Math.floor((sorted.length - 1) * position)];
    };
    const eyeYawSpan = percentile("eyeYaw", 0.9) - percentile("eyeYaw", 0.1);
    const eyePitchSpan = percentile("eyePitch", 0.9) - percentile("eyePitch", 0.1);
    const headYawSpan = percentile("headYaw", 0.9) - percentile("headYaw", 0.1);
    const headPitchSpan = percentile("headPitch", 0.9) - percentile("headPitch", 0.1);
    const unstable =
      eyeYawSpan > 0.12 ||
      eyePitchSpan > 0.15 ||
      headYawSpan > 0.12 ||
      headPitchSpan > 0.12;
    const warnings: string[] = [];
    if (values.length < 20) warnings.push("Too few samples.");
    if (usableRatio < 0.8) warnings.push("Tracking was unstable.");
    if (unstable) warnings.push("Pose changed too much during the hold; repeat this target.");
    return [target, {
      score: Math.min(
        1,
        usableRatio *
          (values.length >= 20 ? 1 : 0.65) *
          (unstable ? 0.65 : 1),
      ),
      usableRatio,
      warnings,
    }];
  }));
}
