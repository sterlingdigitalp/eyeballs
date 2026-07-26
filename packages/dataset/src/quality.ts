import type { GazePrediction } from "../../contracts/src";
import type { SpeakingWindow } from "../../coaching/src/speaking";

export interface QualityComponents {
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
  /** Never used as an auto-approve gate. */
  recommendationOnly: true;
}

export interface QualityInput {
  predictions: GazePrediction[];
  speakingWindows?: SpeakingWindow[];
  droppedFrameCount?: number;
  totalFrames?: number;
  peakDbfsSamples?: number[];
  syncConfidence?: number;
  blinkFrameCount?: number;
}

export function scoreTechnicalQuality(input: QualityInput): QualityComponents {
  const predictions = input.predictions;
  const total = predictions.length || 1;
  const faceDetectedRatio =
    predictions.filter((prediction) => prediction.state !== "unknown").length / total;
  // Prototype metric: overall contact among frames (not speaking-window gated until
  // speaking windows are persisted on sessions). Do not treat as longitudinal truth.
  const contactFrames = predictions.filter((prediction) => prediction.state === "contact").length;
  const contactDuringSpeaking = contactFrames / total;
  const droppedFrameRatio =
    (input.droppedFrameCount ?? 0) / Math.max(1, input.totalFrames ?? total);
  const peaks = input.peakDbfsSamples ?? [-12];
  const clippingRatio = peaks.filter((value) => value > -1).length / peaks.length;
  const silenceRatio = peaks.filter((value) => value < -50).length / peaks.length;
  const loudnessScore = Math.max(
    0,
    Math.min(1, (Math.abs(peaks.reduce((a, b) => a + b, 0) / peaks.length) - 5) / 40),
  );
  const blinkProxy = Math.min(
    1,
    (input.blinkFrameCount ?? 0) / Math.max(1, total / 30),
  );
  const speaking = input.speakingWindows ?? [];
  const completeUtteranceProxy = speaking.length
    ? Math.min(1, speaking.filter((window) => window.endUs - window.startUs > 1_000_000).length /
        speaking.length)
    : 0.5;

  return {
    video: {
      faceDetectedRatio,
      sharpnessProxy: faceDetectedRatio * 0.9,
      exposureStability: 1 - Math.min(1, droppedFrameRatio * 2),
      droppedFrameRatio,
    },
    audio: {
      clippingRatio,
      loudnessScore,
      silenceRatio,
      syncConfidence: input.syncConfidence ?? 0.8,
    },
    performance: {
      contactDuringSpeaking,
      naturalBlinkProxy: blinkProxy,
      completeUtteranceProxy,
    },
    recommendationOnly: true,
  };
}

/** Technical scores must never auto-approve clips. */
export function qualityAutoApproves(): false {
  return false;
}
