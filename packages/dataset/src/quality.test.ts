import { describe, expect, it } from "vitest";
import type { GazePrediction } from "../../contracts/src";
import { qualityAutoApproves, scoreTechnicalQuality } from "./quality";

const prediction = (
  state: GazePrediction["state"],
  confidence = 0.9,
  timestampUs = 0,
): GazePrediction => ({
  timestampUs,
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
    expect(score.scoringVersion).toBe("technical-quality/1.0.0");
    expect(score.video.faceDetectedRatio).toBeCloseTo(0.75);
    expect(score.audio.clippingRatio).toBeCloseTo(1 / 3);
    expect(score.performance.contactDuringSpeaking).toBeCloseTo(0.5);
    expect(qualityAutoApproves()).toBe(false);
    // Not a single opaque gate field
    expect("overall" in score).toBe(false);
    expect("pass" in score).toBe(false);
  });

  it("gates contact to speaking windows and never invents absent measurements", () => {
    const score = scoreTechnicalQuality({
      predictions: [
        prediction("off_lens", 0.9, 500_000),
        prediction("contact", 0.9, 2_000_000),
        prediction("contact", 0.9, 2_500_000),
      ],
      speakingWindows: [{ startUs: 1_500_000, endUs: 3_000_000 }],
    });

    expect(score.performance.contactDuringSpeaking).toBe(1);
    expect(score.audio.syncConfidence).toBe(0);
    expect(score.video.sharpnessProxy).toBe(0);
    expect(score.availability.audioLevels).toBe(false);
    expect(score.availability.sync).toBe(false);
    expect(score.warnings).toEqual(
      expect.arrayContaining([
        "sharpness_unmeasured",
        "audio_levels_unmeasured",
        "sync_unmeasured",
      ]),
    );
  });

  it("uses measured image signals and penalizes verbal mistake candidates", () => {
    const score = scoreTechnicalQuality({
      predictions: [prediction("contact", 0.9, 500_000)],
      speakingWindows: [{ startUs: 0, endUs: 2_000_000 }],
      sharpnessSamples: [0.8, 0.6],
      lumaSamples: [100, 102, 98],
      speechStructureEvents: [
        {
          id: "retake",
          kind: "retake_candidate",
          startUs: 200_000,
          endUs: 800_000,
          confidence: 0.8,
          evidence: ["repeat"],
        },
      ],
    });

    expect(score.video.sharpnessProxy).toBeCloseTo(0.7);
    expect(score.video.exposureStability).toBeGreaterThan(0.9);
    expect(score.performance.completeUtteranceProxy).toBe(0.5);
    expect(score.availability.speechStructure).toBe(true);
  });
});
