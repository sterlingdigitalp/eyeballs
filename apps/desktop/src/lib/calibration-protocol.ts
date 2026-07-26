import type { CalibrationTarget } from "../../../../packages/contracts/src";
import {
  CALIBRATION_GUIDES,
  type CalibrationGuide,
} from "./calibration-guide";

export const CALIBRATION_PROTOCOL_VERSION = "guided-personalized/2.0.1";

export interface CalibrationProtocolStep extends CalibrationGuide {
  id: string;
  target: CalibrationTarget;
  spokenPrompt?: string;
}

const step = (
  id: string,
  target: CalibrationTarget,
  overrides: Partial<Omit<CalibrationProtocolStep, "id" | "target">> = {},
): CalibrationProtocolStep => ({
  id,
  target,
  ...CALIBRATION_GUIDES[target],
  ...overrides,
});

export const TRAINING_CALIBRATION_STEPS: CalibrationProtocolStep[] = [
  step("lens-relaxed-1", "lens", {
    title: "Lens baseline · relaxed 1 of 2",
  }),
  step("lens-relaxed-2", "lens", {
    title: "Lens baseline · relaxed 2 of 2",
    settleSeconds: 3,
  }),
  step("lens-speaking", "lens", {
    title: "Lens baseline · speaking",
    shortInstruction: "SPEAK · CAMERA LENS ↑",
    faceInstruction: "Face: use your normal speaking posture.",
    eyeInstruction:
      "Eyes: look into the physical glass camera lens while saying the sentence below.",
    settleSeconds: 4,
    collectMs: 6_000,
    spokenPrompt: "Today I am speaking directly to the people on the other side of this camera.",
  }),
  step("near-lens", "near_lens", { collectMs: 3_000 }),
  step("screen-center", "screen_center", { collectMs: 3_000 }),
  step("notes", "down", { collectMs: 3_000 }),
  step("left-edge", "left", { collectMs: 3_000 }),
  step("right-edge", "right", { collectMs: 3_000 }),
  step("above-lens", "above_lens"),
  step("self-preview", "self_preview"),
  step("head-left", "head_left_eyes_lens", { collectMs: 4_000 }),
  step("head-right", "head_right_eyes_lens", { collectMs: 4_000 }),
  step("head-down", "head_down_eyes_lens"),
];

export const VALIDATION_CALIBRATION_STEPS: CalibrationProtocolStep[] = [
  step("validate-lens", "lens", {
    title: "Validation · physical lens",
    settleSeconds: 4,
    collectMs: 3_000,
  }),
  step("validate-near-lens", "near_lens", { collectMs: 2_500 }),
  step("validate-screen", "screen_center", { collectMs: 2_500 }),
  step("validate-notes", "down", { collectMs: 2_500 }),
  step("validate-left", "left", { collectMs: 2_500 }),
  step("validate-right", "right", { collectMs: 2_500 }),
  step("validate-above", "above_lens", { collectMs: 2_500 }),
  step("validate-preview", "self_preview", { collectMs: 2_500 }),
  step("validate-head-left", "head_left_eyes_lens", { collectMs: 3_000 }),
  step("validate-head-right", "head_right_eyes_lens", { collectMs: 3_000 }),
  step("validate-head-down", "head_down_eyes_lens", { collectMs: 3_000 }),
];

export const QUICK_LENS_VERIFICATION_STEPS: CalibrationProtocolStep[] = [
  step("quick-lens", "lens", {
    title: "Quick physical-lens verification",
    collectMs: 4_000,
  }),
];

export function shuffledValidationSteps(
  random: () => number = Math.random,
): CalibrationProtocolStep[] {
  const values = [...VALIDATION_CALIBRATION_STEPS];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

export function protocolDurationMs(steps: CalibrationProtocolStep[]): number {
  return steps.reduce(
    (total, value) => total + value.settleSeconds * 1_000 + value.collectMs,
    0,
  );
}
