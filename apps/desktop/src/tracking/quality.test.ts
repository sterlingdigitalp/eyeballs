import { describe, expect, it } from "vitest";
import { geometricTrackingConfidence, isBilateralBlink } from "./quality";

describe("geometric tracking confidence", () => {
  it("suppresses bilateral blinks without treating a one-eye dropout as a blink", () => {
    expect(isBilateralBlink({
      leftBlendshape: 0.9,
      rightBlendshape: 0.85,
      leftEyeOpen: 0.01,
      rightEyeOpen: 0.012,
    })).toBe(true);
    expect(isBilateralBlink({
      leftBlendshape: 0.9,
      rightBlendshape: 0.1,
      leftEyeOpen: 0.01,
      rightEyeOpen: 0.04,
    })).toBe(false);
  });

  it("accepts a normally framed face with plausible iris landmarks", () => {
    expect(geometricTrackingConfidence({
      faceScale: 0.22,
      leftYaw: 0.1,
      rightYaw: 0.08,
      leftPitch: -0.1,
      rightPitch: -0.08,
    })).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps a very small face below the calibration threshold", () => {
    expect(geometricTrackingConfidence({
      faceScale: 0.07,
      leftYaw: 0,
      rightYaw: 0,
      leftPitch: 0,
      rightPitch: 0,
    })).toBeLessThan(0.65);
  });

  it("rejects anatomically implausible iris geometry", () => {
    expect(geometricTrackingConfidence({
      faceScale: 0.22,
      leftYaw: 2,
      rightYaw: 0,
      leftPitch: 0,
      rightPitch: 0,
    })).toBeLessThan(0.65);
  });

  it("rejects a reflection-like fit where the two irises strongly disagree", () => {
    expect(geometricTrackingConfidence({
      faceScale: 0.22,
      leftYaw: 0.8,
      rightYaw: -0.8,
      leftPitch: 0,
      rightPitch: 0,
    })).toBeLessThan(0.65);
  });
});
