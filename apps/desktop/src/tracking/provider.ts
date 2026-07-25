import type { FeatureVector } from "../../../../packages/contracts/src";

export interface AnalysisFrame {
  video: HTMLVideoElement;
  timestampMs: number;
}

export interface TrackingProvider {
  readonly id: string;
  readonly version: string;
  initialize(): Promise<void>;
  analyze(frame: AnalysisFrame): Promise<FeatureVector>;
  shutdown(): Promise<void>;
}

export class VideoFrameWatchdog {
  private lastMediaTime = -1;
  private lastAdvanceMs = 0;

  constructor(private readonly stallAfterMs = 750) {}

  update(mediaTimeSeconds: number, nowMs: number): "advancing" | "waiting" | "stalled" {
    if (
      this.lastMediaTime < 0 ||
      mediaTimeSeconds > this.lastMediaTime + 0.0001
    ) {
      this.lastMediaTime = mediaTimeSeconds;
      this.lastAdvanceMs = nowMs;
      return "advancing";
    }
    return nowMs - this.lastAdvanceMs >= this.stallAfterMs
      ? "stalled"
      : "waiting";
  }
}

export function unknownFeature(timestampMs: number): FeatureVector {
  return {
    schemaVersion: "1.0.0",
    timestampUs: Math.round(timestampMs * 1000),
    confidence: 0,
    faceDetected: false,
    blink: false,
    eyeYaw: 0,
    eyePitch: 0,
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    faceScale: 0.01,
  };
}
