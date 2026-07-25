import { describe, expect, it } from "vitest";
import {
  protocolDurationMs,
  shuffledValidationSteps,
  TRAINING_CALIBRATION_STEPS,
  VALIDATION_CALIBRATION_STEPS,
} from "./calibration-protocol";

describe("full calibration protocol", () => {
  it("covers repeated lens, negative, and three head/eye disambiguation cases", () => {
    const targets = TRAINING_CALIBRATION_STEPS.map((step) => step.target);
    expect(targets.filter((target) => target === "lens")).toHaveLength(3);
    expect(targets).toEqual(expect.arrayContaining([
      "near_lens",
      "screen_center",
      "down",
      "left",
      "right",
      "above_lens",
      "self_preview",
      "head_left_eyes_lens",
      "head_right_eyes_lens",
      "head_down_eyes_lens",
    ]));
  });

  it("takes between two and four minutes including the independent validation pass", () => {
    const duration =
      protocolDurationMs(TRAINING_CALIBRATION_STEPS) +
      protocolDurationMs(VALIDATION_CALIBRATION_STEPS);
    expect(duration).toBeGreaterThanOrEqual(120_000);
    expect(duration).toBeLessThanOrEqual(240_000);
  });

  it("randomizes validation order without changing coverage", () => {
    const randomValues = [0.1, 0.8, 0.3, 0.6, 0.2, 0.9, 0.4, 0.7, 0.5, 0];
    let index = 0;
    const shuffled = shuffledValidationSteps(
      () => randomValues[index++ % randomValues.length],
    );
    expect(shuffled.map((step) => step.id)).not.toEqual(
      VALIDATION_CALIBRATION_STEPS.map((step) => step.id),
    );
    expect(new Set(shuffled.map((step) => step.target))).toEqual(
      new Set(VALIDATION_CALIBRATION_STEPS.map((step) => step.target)),
    );
  });
});
