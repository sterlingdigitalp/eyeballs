import { describe, expect, it } from "vitest";
import {
  calibrationSamplesFromIntervals,
  correctionsFromIntervals,
  summarizeCalibrationStability,
  summarizeTrackerFeatures,
} from "./benchmark";
import { feature } from "./test-fixtures";

describe("same-corpus tracker benchmark helpers", () => {
  it("maps relative labeled intervals onto monotonic tracker timestamps", () => {
    const originUs = 500_000_000;
    const features = [
      feature({ timestampUs: originUs }),
      feature({ timestampUs: originUs + 1_000_000 }),
      feature({ timestampUs: originUs + 2_000_000 }),
    ];
    const samples = calibrationSamplesFromIntervals(features, originUs, [
      { startSeconds: 0, endSeconds: 2, target: "lens" },
      { startSeconds: 2, endSeconds: 3, target: "left" },
    ]);
    expect(samples.map((sample) => sample.target)).toEqual(["lens", "lens", "left"]);
    const corrections = correctionsFromIntervals("session", originUs, [
      { startSeconds: 1, endSeconds: 2, label: "contact" },
    ]);
    expect(corrections[0]).toMatchObject({
      startUs: originUs + 1_000_000,
      endUs: originUs + 2_000_000,
    });
  });

  it("reports detection, usability, blink, and latency summaries", () => {
    const summary = summarizeTrackerFeatures([
      feature({ analysisLatencyMs: 2 }),
      feature({ analysisLatencyMs: 4, blink: true }),
      feature({ analysisLatencyMs: 8, faceDetected: false, confidence: 0 }),
    ]);
    expect(summary).toMatchObject({
      frames: 3,
      detectionRate: 2 / 3,
      usableRate: 1 / 3,
      blinkFrames: 1,
      medianLatencyMs: 4,
      p95LatencyMs: 8,
    });
  });

  it("reports eye/head jitter within each stable calibration interval", () => {
    const values = [
      feature({ timestampUs: 0, eyeYaw: 0, headYaw: 0 }),
      feature({ timestampUs: 100_000, eyeYaw: 0.01, headYaw: 0.02 }),
      feature({ timestampUs: 200_000, eyeYaw: 0.02, headYaw: 0.04 }),
    ];
    const [summary] = summarizeCalibrationStability(values, 0, [
      { startSeconds: 0, endSeconds: 1, target: "lens" },
    ]);
    expect(summary.usableFrames).toBe(3);
    expect(summary.medianEyeJitter).toBeCloseTo(0.01);
    expect(summary.p95HeadJitter).toBeCloseTo(0.02);
  });
});
