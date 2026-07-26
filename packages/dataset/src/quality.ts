import type { FeatureVector, GazePrediction } from "../../contracts/src";
import type { SpeakingWindow } from "../../coaching/src/speaking";
import type { SpeechStructureEvent } from "./speech-structure";

export const QUALITY_SCORING_VERSION = "technical-quality/1.0.0";

export interface QualityComponents {
  scoringVersion: typeof QUALITY_SCORING_VERSION;
  video: {
    faceDetectedRatio: number;
    sharpnessProxy: number;
    exposureStability: number;
    droppedFrameRatio: number;
  };
  audio: {
    clippingRatio: number;
    loudnessScore: number;
    silenceRatio: number;
    syncConfidence: number;
  };
  performance: {
    contactDuringSpeaking: number;
    naturalBlinkProxy: number;
    completeUtteranceProxy: number;
  };
  availability: {
    sharpness: boolean;
    exposure: boolean;
    audioLevels: boolean;
    sync: boolean;
    blink: boolean;
    speechStructure: boolean;
  };
  warnings: string[];
  /** Never used as an auto-approve gate. */
  recommendationOnly: true;
}

export interface QualityInput {
  predictions: GazePrediction[];
  features?: FeatureVector[];
  speakingWindows?: SpeakingWindow[];
  droppedFrameCount?: number;
  totalFrames?: number;
  peakDbfsSamples?: number[];
  sharpnessSamples?: number[];
  lumaSamples?: number[];
  syncConfidence?: number;
  blinkFrameCount?: number;
  speechStructureEvents?: SpeechStructureEvent[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationStdDev(values: readonly number[]): number {
  if (!values.length) return 0;
  const mean = average(values);
  return Math.sqrt(
    average(values.map((value) => (value - mean) ** 2)),
  );
}

function isInsideSpeakingWindow(
  prediction: GazePrediction,
  windows: readonly SpeakingWindow[],
): boolean {
  return windows.some(
    (window) =>
      prediction.timestampUs >= window.startUs &&
      prediction.timestampUs <= window.endUs,
  );
}

export function scoreTechnicalQuality(input: QualityInput): QualityComponents {
  const predictions = input.predictions;
  const features = input.features ?? [];
  const total = Math.max(1, features.length || predictions.length);
  const faceDetectedRatio = features.length
    ? features.filter((feature) => feature.faceDetected).length / total
    : predictions.filter((prediction) => prediction.state !== "unknown").length /
      total;
  const speaking = input.speakingWindows ?? [];
  const speakingPredictions = speaking.length
    ? predictions.filter((prediction) =>
        isInsideSpeakingWindow(prediction, speaking),
      )
    : predictions;
  const contactFrames = speakingPredictions.filter(
    (prediction) => prediction.state === "contact",
  ).length;
  const contactDuringSpeaking =
    contactFrames / Math.max(1, speakingPredictions.length);
  const droppedFrameRatio =
    (input.droppedFrameCount ?? 0) / Math.max(1, input.totalFrames ?? total);
  const peaks = input.peakDbfsSamples ?? [];
  const clippingRatio = peaks.length
    ? peaks.filter((value) => value > -1).length / peaks.length
    : 0;
  const silenceRatio = peaks.length
    ? peaks.filter((value) => value < -50).length / peaks.length
    : 0;
  // Peak samples are only a level proxy, not integrated loudness. Prefer a
  // healthy center near -14 dBFS while retaining the component name for schema
  // compatibility.
  const loudnessScore = peaks.length
    ? clamp01(1 - Math.abs(average(peaks) + 14) / 30)
    : 0;
  const blinkProxy = Math.min(
    1,
    (input.blinkFrameCount ?? 0) / Math.max(1, total / 30),
  );
  let completeUtteranceProxy = speaking.length
    ? Math.min(1, speaking.filter((window) => window.endUs - window.startUs > 1_000_000).length /
        speaking.length)
    : 0.5;
  const verbalMistakes = (input.speechStructureEvents ?? []).filter(
    (event) => event.kind !== "long_pause",
  );
  if (verbalMistakes.length) {
    completeUtteranceProxy *= 1 / (1 + verbalMistakes.length);
  }
  const sharpness = input.sharpnessSamples ?? [];
  const luma = input.lumaSamples ?? [];
  const warnings: string[] = [];
  if (!sharpness.length) warnings.push("sharpness_unmeasured");
  if (!luma.length) warnings.push("exposure_stability_unmeasured");
  if (!peaks.length) warnings.push("audio_levels_unmeasured");
  if (input.syncConfidence === undefined) warnings.push("sync_unmeasured");
  if (input.blinkFrameCount === undefined) warnings.push("blink_unmeasured");
  if (!input.speechStructureEvents) warnings.push("speech_structure_unmeasured");

  return {
    scoringVersion: QUALITY_SCORING_VERSION,
    video: {
      faceDetectedRatio,
      sharpnessProxy: sharpness.length ? clamp01(average(sharpness)) : 0,
      exposureStability: luma.length
        ? clamp01(1 - populationStdDev(luma) / 64)
        : 0,
      droppedFrameRatio,
    },
    audio: {
      clippingRatio,
      loudnessScore,
      silenceRatio,
      syncConfidence: input.syncConfidence ?? 0,
    },
    performance: {
      contactDuringSpeaking,
      naturalBlinkProxy: blinkProxy,
      completeUtteranceProxy,
    },
    availability: {
      sharpness: sharpness.length > 0,
      exposure: luma.length > 0,
      audioLevels: peaks.length > 0,
      sync: input.syncConfidence !== undefined,
      blink: input.blinkFrameCount !== undefined,
      speechStructure: input.speechStructureEvents !== undefined,
    },
    warnings,
    recommendationOnly: true,
  };
}

/** Technical scores must never auto-approve clips. */
export function qualityAutoApproves(): false {
  return false;
}
