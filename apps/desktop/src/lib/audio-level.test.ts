import { describe, expect, it } from "vitest";
import { audioMeterPercent, rmsDbfs } from "./audio-level";

describe("microphone level diagnostics", () => {
  it("reports silence at the meter floor", () => {
    expect(rmsDbfs(new Float32Array(128))).toBe(-120);
    expect(audioMeterPercent(-120)).toBe(0);
  });

  it("calculates RMS dBFS and clamps the visible meter", () => {
    expect(rmsDbfs(new Float32Array([0.5, -0.5]))).toBeCloseTo(-6.0206, 3);
    expect(audioMeterPercent(-30)).toBe(50);
    expect(audioMeterPercent(4)).toBe(100);
  });
});
