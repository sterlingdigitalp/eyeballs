import { describe, expect, it } from "vitest";
import { assessBrightness } from "./frame-quality";

const pixels = (luma: number) => new Uint8ClampedArray([
  luma, luma, luma, 255,
  luma, luma, luma, 255,
]);

describe("calibration lighting preflight", () => {
  it("identifies dark, usable, and overexposed frames", () => {
    expect(assessBrightness(pixels(20)).status).toBe("too_dark");
    expect(assessBrightness(pixels(120)).status).toBe("good");
    expect(assessBrightness(pixels(240)).status).toBe("too_bright");
  });
});
