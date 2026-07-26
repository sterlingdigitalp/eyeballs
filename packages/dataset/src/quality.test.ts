import { describe, expect, it } from "vitest";
import type { GazePrediction } from "../../contracts/src";
import { qualityAutoApproves, scoreTechnicalQuality } from "./quality";

const prediction = (state: GazePrediction["state"], confidence = 0.9): GazePrediction => ({
  timestampUs: 0,
  state,
  confidence,
  rawState: state,
  blinkSuppressed: false,
  calibrationId: "c",
  trackerId: "t",
  trackerVersion: "1",
  algorithmVersion: "a",
});

describe("technical quality scoring", () => {
  it("returns multi-component scores that are recommendation-only", () => {
    const score = scoreTechnicalQuality({
      predictions: [
        prediction("contact"),
        prediction("contact"),
        prediction("off_lens"),
        prediction("unknown"),
      ],
      droppedFrameCount: 2,
      totalFrames: 100,
      peakDbfsSamples: [-8, -12, -0.5],
      syncConfidence: 0.85,
      speakingWindows: [{ startUs: 0, endUs: 2_000_000 }],
      blinkFrameCount: 3,
    });
    expect(score.recommendationOnly).toBe(true);
    expect(score.video.faceDetectedRatio).toBeCloseTo(0.75);
    expect(score.audio.clippingRatio).toBeCloseTo(1 / 3);
    expect(score.performance.contactDuringSpeaking).toBeCloseTo(0.5);
    expect(qualityAutoApproves()).toBe(false);
    // Not a single opaque gate field
    expect("overall" in score).toBe(false);
    expect("pass" in score).toBe(false);
  });
});
