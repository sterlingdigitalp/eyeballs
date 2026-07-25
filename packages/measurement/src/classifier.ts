import type {
  Calibration,
  CalibrationTarget,
  FeatureVector,
  GazePrediction,
  GazeState,
} from "../../contracts/src";

export const ALGORITHM_VERSION = "cluster-hysteresis/1.2.1";

type Point = [number, number, number, number];

const toPoint = (feature: FeatureVector): Point => [
  feature.eyeYaw,
  feature.eyePitch,
  feature.headYaw * 0.45,
  feature.headPitch * 0.45,
];

const distance = (a: Point, b: Point): number =>
  Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));

const quantile = (values: number[], position: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * position)));
  return sorted[index];
};

const robustCenter = (points: Point[]): Point =>
  [0, 1, 2, 3].map((index) => quantile(points.map((point) => point[index]), 0.5)) as Point;

const targetState = (target: CalibrationTarget): GazeState => {
  if (target === "lens" || target.startsWith("head_")) return "contact";
  if (target === "near_lens") return "near_lens";
  return "off_lens";
};

export interface ClassifierModel {
  calibrationId: string;
  trackerId: string;
  trackerVersion: string;
  prototypes: Array<{ state: GazeState; point: Point; radius: number }>;
  contactRadius: number;
}

export function trainClassifier(calibration: Calibration): ClassifierModel {
  const grouped = new Map<CalibrationTarget, Point[]>();
  for (const sample of calibration.samples) {
    if (!sample.feature.faceDetected || sample.feature.blink || sample.feature.confidence < 0.65) continue;
    grouped.set(sample.target, [...(grouped.get(sample.target) ?? []), toPoint(sample.feature)]);
  }
  const prototypes = [...grouped.entries()].map(([target, points]) => {
    const point = robustCenter(points);
    return {
      state: targetState(target),
      point,
      radius: Math.max(
        0.02,
        quantile(points.map((value) => distance(value, point)), 0.9),
      ),
    };
  });
  const contactPoints = calibration.samples
    .filter(
      (sample) =>
        targetState(sample.target) === "contact" &&
        sample.feature.faceDetected &&
        !sample.feature.blink &&
        sample.feature.confidence >= 0.65,
    )
    .map((sample) => toPoint(sample.feature));
  const offPrototypes = prototypes.filter((prototype) => prototype.state === "off_lens");
  if (!contactPoints.length || !offPrototypes.length) {
    throw new Error("Calibration needs stable lens and off-lens samples.");
  }
  const contact = robustCenter(contactPoints);
  const contactDistances = contactPoints.map((point) => distance(point, contact));
  const offDistance = Math.min(...offPrototypes.map((prototype) => distance(contact, prototype.point)));
  const spread = Math.max(0.025, quantile(contactDistances, 0.9));
  return {
    calibrationId: calibration.id,
    trackerId: calibration.trackerId,
    trackerVersion: calibration.trackerVersion,
    prototypes,
    contactRadius: Math.min(offDistance * 0.48, spread * 2.5),
  };
}

export function classifyFrame(model: ClassifierModel, feature: FeatureVector): GazePrediction {
  let rawState: GazeState = "unknown";
  let confidence = 0;
  let classProbabilities = {
    contact: 0,
    near_lens: 0,
    off_lens: 0,
    unknown: 1,
  };
  if (feature.faceDetected && feature.confidence >= 0.55 && !feature.blink) {
    const point = toPoint(feature);
    const ranked = model.prototypes
      .map((prototype) => ({
        state: prototype.state,
        radius: prototype.radius,
        distance: distance(point, prototype.point),
      }))
      .sort((a, b) => a.distance - b.distance);
    const first = ranked[0];
    const second = ranked[1];
    if (first) {
      const relativeSeparation = second
        ? Math.max(0, second.distance - first.distance) /
          Math.max(0.001, second.distance)
        : 1;
      const knownRadius = Math.max(0.16, first.radius * 4);
      const proximity = Math.max(0, 1 - first.distance / knownRadius);
      confidence = Math.min(
        feature.confidence,
        0.45 + relativeSeparation * 0.4 + proximity * 0.15,
      );
      const ambiguous = Boolean(second && relativeSeparation < 0.08);
      const outOfDistribution = first.distance > knownRadius;
      const knownWeights = {
        contact: 0,
        near_lens: 0,
        off_lens: 0,
      };
      for (const candidate of ranked) {
        knownWeights[candidate.state as keyof typeof knownWeights] = Math.max(
          knownWeights[candidate.state as keyof typeof knownWeights],
          Math.exp(-candidate.distance / 0.08),
        );
      }
      const knownTotal =
        knownWeights.contact + knownWeights.near_lens + knownWeights.off_lens;
      const unknownWeight =
        ambiguous || outOfDistribution
          ? Math.max(knownTotal, 1)
          : Math.max(0.01, (1 - feature.confidence) * Math.max(knownTotal, 0.1));
      const total = Math.max(0.001, knownTotal + unknownWeight);
      classProbabilities = {
        contact: knownWeights.contact / total,
        near_lens: knownWeights.near_lens / total,
        off_lens: knownWeights.off_lens / total,
        unknown: unknownWeight / total,
      };
      if (!ambiguous && !outOfDistribution) {
        rawState = first.state;
        if (rawState === "contact" && first.distance > model.contactRadius) {
          rawState = "near_lens";
        }
      } else {
        confidence = Math.min(confidence, 0.54);
      }
    }
  }
  return {
    timestampUs: feature.timestampUs,
    state: rawState,
    rawState,
    confidence,
    classProbabilities,
    blinkSuppressed: feature.blink,
    calibrationId: model.calibrationId,
    trackerId: model.trackerId,
    trackerVersion: model.trackerVersion,
    algorithmVersion: ALGORITHM_VERSION,
  };
}

export interface TemporalPolicy {
  enterOffLensMs: number;
  returnContactMs: number;
  unknownAfterMs: number;
}

export class TemporalClassifier {
  private current: GazeState = "unknown";
  private candidate: GazeState | undefined;
  private candidateSinceUs = 0;
  private lastStable: GazeState = "unknown";

  constructor(private readonly policy: TemporalPolicy = {
    enterOffLensMs: 450,
    returnContactMs: 180,
    unknownAfterMs: 250,
  }) {}

  update(prediction: GazePrediction): GazePrediction {
    if (prediction.blinkSuppressed) {
      this.candidate = undefined;
      this.candidateSinceUs = prediction.timestampUs;
      return { ...prediction, state: this.lastStable, confidence: Math.max(0.5, prediction.confidence) };
    }
    if (prediction.rawState !== this.candidate) {
      this.candidate = prediction.rawState;
      this.candidateSinceUs = prediction.timestampUs;
    }
    const elapsedMs = (prediction.timestampUs - this.candidateSinceUs) / 1000;
    const threshold =
      this.candidate === "off_lens"
        ? this.policy.enterOffLensMs
        : this.candidate === "unknown"
          ? this.policy.unknownAfterMs
          : this.policy.returnContactMs;
    if (elapsedMs >= threshold) {
      this.current = this.candidate;
      if (this.current !== "unknown") this.lastStable = this.current;
    }
    return { ...prediction, state: this.current };
  }

  reset(): void {
    this.current = "unknown";
    this.candidate = undefined;
    this.candidateSinceUs = 0;
    this.lastStable = "unknown";
  }
}
