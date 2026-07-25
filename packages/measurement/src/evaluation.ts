import type { Correction, GazePrediction } from "../../contracts/src";

export interface ConfusionMatrix {
  trueContact: number;
  trueNotContact: number;
  falseContact: number;
  falseNotContact: number;
  unknown: number;
  agreement: number;
  decisionCoverage: number;
  falseCueRatePerMinute: number;
  labeledDurationUs: number;
}

function labelAt(timestampUs: number, corrections: Correction[]): Correction["label"] | undefined {
  for (let index = corrections.length - 1; index >= 0; index -= 1) {
    const correction = corrections[index];
    if (timestampUs >= correction.startUs && timestampUs < correction.endUs) {
      return correction.label;
    }
  }
  return undefined;
}

export interface EffectiveLabelSegment {
  startUs: number;
  endUs: number;
  label: Correction["label"];
}

export function effectiveLabelSegments(
  corrections: Correction[],
): EffectiveLabelSegment[] {
  const boundaries = [...new Set(
    corrections.flatMap((correction) => [correction.startUs, correction.endUs]),
  )].sort((a, b) => a - b);
  const segments: EffectiveLabelSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startUs = boundaries[index];
    const endUs = boundaries[index + 1];
    if (endUs <= startUs) continue;
    const label = labelAt(startUs, corrections);
    if (!label) continue;
    const prior = segments.at(-1);
    if (prior?.label === label && prior.endUs === startUs) {
      prior.endUs = endUs;
    } else {
      segments.push({ startUs, endUs, label });
    }
  }
  return segments;
}

export interface EventTimingMetrics {
  breaksEvaluated: number;
  breaksDetected: number;
  missedBreaks: number;
  medianBreakOnsetMs: number | null;
  p95BreakOnsetMs: number | null;
  recoveriesEvaluated: number;
  recoveriesDetected: number;
  missedRecoveries: number;
  medianRecoveryMs: number | null;
  p95RecoveryMs: number | null;
}

const quantile = (values: number[], position: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((sorted.length - 1) * position)];
};

export function calculateEventTiming(
  predictions: GazePrediction[],
  corrections: Correction[],
): EventTimingMetrics {
  const segments = effectiveLabelSegments(corrections);
  const breakOnsetsMs: number[] = [];
  const recoveriesMs: number[] = [];
  let breaksEvaluated = 0;
  let recoveriesEvaluated = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.label !== "not_contact") continue;
    breaksEvaluated += 1;
    const detectedBreak = predictions.find(
      (prediction) =>
        prediction.timestampUs >= segment.startUs &&
        prediction.timestampUs < segment.endUs &&
        prediction.state === "off_lens",
    );
    if (detectedBreak) {
      breakOnsetsMs.push((detectedBreak.timestampUs - segment.startUs) / 1000);
    }

    const next = segments[index + 1];
    if (
      !next ||
      next.label !== "contact" ||
      next.startUs !== segment.endUs
    ) {
      continue;
    }
    recoveriesEvaluated += 1;
    const detectedRecovery = predictions.find(
      (prediction) =>
        prediction.timestampUs >= next.startUs &&
        prediction.timestampUs < next.endUs &&
        (prediction.state === "contact" || prediction.state === "near_lens"),
    );
    if (detectedRecovery) {
      recoveriesMs.push((detectedRecovery.timestampUs - next.startUs) / 1000);
    }
  }

  return {
    breaksEvaluated,
    breaksDetected: breakOnsetsMs.length,
    missedBreaks: breaksEvaluated - breakOnsetsMs.length,
    medianBreakOnsetMs: quantile(breakOnsetsMs, 0.5),
    p95BreakOnsetMs: quantile(breakOnsetsMs, 0.95),
    recoveriesEvaluated,
    recoveriesDetected: recoveriesMs.length,
    missedRecoveries: recoveriesEvaluated - recoveriesMs.length,
    medianRecoveryMs: quantile(recoveriesMs, 0.5),
    p95RecoveryMs: quantile(recoveriesMs, 0.95),
  };
}

export function sessionRelativeSecondsToUs(
  sessionStartUs: number,
  seconds: number,
): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Session-relative time must be a non-negative number.");
  }
  return sessionStartUs + Math.round(seconds * 1_000_000);
}

export function mergedLabeledDurationUs(corrections: Correction[]): number {
  return effectiveLabelSegments(corrections)
    .filter((segment) => segment.label !== "unknown")
    .reduce((total, segment) => total + segment.endUs - segment.startUs, 0);
}

export function calculateConfusionMatrix(
  predictions: GazePrediction[],
  corrections: Correction[],
): ConfusionMatrix {
  let trueContact = 0;
  let trueNotContact = 0;
  let falseContact = 0;
  let falseNotContact = 0;
  let unknown = 0;
  let evaluated = 0;
  let falseCueTransitions = 0;
  let priorWasFalseCue = false;

  for (const prediction of predictions) {
    const label = labelAt(prediction.timestampUs, corrections);
    if (!label) {
      priorWasFalseCue = false;
      continue;
    }
    if (label === "unknown") {
      unknown += 1;
      priorWasFalseCue = false;
      continue;
    }
    evaluated += 1;
    if (prediction.state === "unknown") {
      unknown += 1;
      priorWasFalseCue = false;
      continue;
    }
    const predictedContact = prediction.state === "contact" || prediction.state === "near_lens";
    const actualContact = label === "contact";
    const falseCue = actualContact && !predictedContact;
    if (falseCue && !priorWasFalseCue) falseCueTransitions += 1;
    priorWasFalseCue = falseCue;
    if (predictedContact && actualContact) trueContact += 1;
    else if (!predictedContact && !actualContact) trueNotContact += 1;
    else if (predictedContact) falseContact += 1;
    else falseNotContact += 1;
  }
  const decided = trueContact + trueNotContact + falseContact + falseNotContact;
  const labeledDurationUs = mergedLabeledDurationUs(corrections);
  const minutes = labeledDurationUs / 60_000_000;
  return {
    trueContact,
    trueNotContact,
    falseContact,
    falseNotContact,
    unknown,
    agreement: evaluated ? (trueContact + trueNotContact) / evaluated : 0,
    decisionCoverage: evaluated ? decided / evaluated : 0,
    falseCueRatePerMinute: minutes ? falseCueTransitions / minutes : 0,
    labeledDurationUs,
  };
}
