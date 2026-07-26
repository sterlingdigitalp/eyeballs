import { describe, expect, it } from "vitest";
import { CALIBRATION_GUIDES, calibrationGuidePoint } from "./calibration-guide";

describe("in-app calibration guide", () => {
  it("defines separate face and eye instructions for every target", () => {
    expect(Object.keys(CALIBRATION_GUIDES)).toHaveLength(11);
    for (const guide of Object.values(CALIBRATION_GUIDES)) {
      const words = guide.shortInstruction.match(/[A-Z]+/g) ?? [];
      expect(words.length).toBeGreaterThanOrEqual(1);
      expect(words.length).toBeLessThanOrEqual(5);
      expect(guide.faceInstruction).toMatch(/^Face:/);
      expect(guide.eyeInstruction).toMatch(/^Eyes:/);
      expect(guide.markerLabel.length).toBeGreaterThan(0);
      expect(guide.settleSeconds).toBeGreaterThanOrEqual(3);
      expect(guide.collectMs).toBeGreaterThanOrEqual(2_000);
    }
  });

  it("gives the physical lens baseline extra settling and collection time", () => {
    expect(CALIBRATION_GUIDES.lens.physicalLens).toBe(true);
    expect(CALIBRATION_GUIDES.lens.settleSeconds).toBe(5);
    expect(CALIBRATION_GUIDES.lens.collectMs).toBe(5_000);
    expect(CALIBRATION_GUIDES.lens.eyeInstruction).toContain("physical glass camera lens");
  });

  it("keeps lens-dependent targets aligned to the saved physical anchor", () => {
    const anchor = { x: 0.43, y: 0.02 };
    expect(calibrationGuidePoint("lens", anchor)).toEqual(anchor);
    expect(calibrationGuidePoint("head_left_eyes_lens", anchor)).toEqual(anchor);
    expect(calibrationGuidePoint("head_right_eyes_lens", anchor)).toEqual(anchor);
    expect(calibrationGuidePoint("head_down_eyes_lens", anchor)).toEqual(anchor);
    const nearLens = calibrationGuidePoint("near_lens", anchor);
    expect(nearLens.x).toBeCloseTo(0.43);
    expect(nearLens.y).toBeCloseTo(0.09);
  });

  it("places negative targets at distinct visible locations", () => {
    const anchor = { x: 0.5, y: 0.015 };
    expect(calibrationGuidePoint("left", anchor).x).toBeLessThan(0.2);
    expect(calibrationGuidePoint("right", anchor).x).toBeGreaterThan(0.8);
    expect(calibrationGuidePoint("down", anchor).y).toBeGreaterThan(0.8);
    expect(calibrationGuidePoint("screen_center", anchor)).toEqual({ x: 0.5, y: 0.5 });
    expect(calibrationGuidePoint("self_preview", anchor)).toEqual({ x: 0.24, y: 0.34 });
  });
});
