import type { CalibrationTarget } from "../../../../packages/contracts/src";

export interface CalibrationGuide {
  title: string;
  faceInstruction: string;
  eyeInstruction: string;
  markerLabel: string;
  settleSeconds: number;
  collectMs: number;
  physicalLens: boolean;
}

export const CALIBRATION_GUIDES: Record<CalibrationTarget, CalibrationGuide> = {
  lens: {
    title: "Lens baseline",
    faceInstruction: "Face: straight ahead in your normal speaking posture.",
    eyeInstruction: "Eyes: look directly into the physical glass camera lens—not at this window. Keep looking there until the end chime.",
    markerLabel: "PHYSICAL LENS",
    settleSeconds: 5,
    collectMs: 5_000,
    physicalLens: true,
  },
  near_lens: {
    title: "Near lens",
    faceInstruction: "Face: keep straight ahead and still.",
    eyeInstruction: "Eyes: look at the target just beneath the lens.",
    markerLabel: "NEAR LENS",
    settleSeconds: 3,
    collectMs: 2_200,
    physicalLens: false,
  },
  left: {
    title: "Left target",
    faceInstruction: "Face: keep straight ahead; do not follow the target.",
    eyeInstruction: "Eyes: look at the target on the left side of the preview.",
    markerLabel: "LOOK LEFT",
    settleSeconds: 3,
    collectMs: 2_200,
    physicalLens: false,
  },
  right: {
    title: "Right target",
    faceInstruction: "Face: keep straight ahead; do not follow the target.",
    eyeInstruction: "Eyes: look at the target on the right side of the preview.",
    markerLabel: "LOOK RIGHT",
    settleSeconds: 3,
    collectMs: 2_200,
    physicalLens: false,
  },
  down: {
    title: "Notes target",
    faceInstruction: "Face: allow only a small, natural downward tilt.",
    eyeInstruction: "Eyes: look at the lower target as if consulting notes.",
    markerLabel: "NOTES",
    settleSeconds: 3,
    collectMs: 2_200,
    physicalLens: false,
  },
  above_lens: {
    title: "Above lens",
    faceInstruction: "Face: keep straight ahead and still.",
    eyeInstruction: "Eyes: look just above the physical glass camera lens until the end chime.",
    markerLabel: "ABOVE LENS",
    settleSeconds: 4,
    collectMs: 3_000,
    physicalLens: true,
  },
  screen_center: {
    title: "Screen target",
    faceInstruction: "Face: return to straight ahead.",
    eyeInstruction: "Eyes: look at the target in the middle of the preview.",
    markerLabel: "SCREEN",
    settleSeconds: 3,
    collectMs: 2_200,
    physicalLens: false,
  },
  self_preview: {
    title: "Self-preview target",
    faceInstruction: "Face: keep straight ahead.",
    eyeInstruction: "Eyes: look at the self-preview target inside the camera image.",
    markerLabel: "SELF PREVIEW",
    settleSeconds: 3,
    collectMs: 3_000,
    physicalLens: false,
  },
  head_left_eyes_lens: {
    title: "Head left, eyes on lens",
    faceInstruction: "Face: turn slightly left.",
    eyeInstruction: "Eyes: stay fixed on the physical glass camera lens—not at this window.",
    markerLabel: "PHYSICAL LENS",
    settleSeconds: 4,
    collectMs: 3_000,
    physicalLens: true,
  },
  head_right_eyes_lens: {
    title: "Head right, eyes on lens",
    faceInstruction: "Face: turn slightly right.",
    eyeInstruction: "Eyes: stay fixed on the physical glass camera lens—not at this window.",
    markerLabel: "PHYSICAL LENS",
    settleSeconds: 4,
    collectMs: 3_000,
    physicalLens: true,
  },
  head_down_eyes_lens: {
    title: "Head down, eyes on lens",
    faceInstruction: "Face: tilt slightly down.",
    eyeInstruction: "Eyes: stay fixed on the physical glass camera lens—not at this window.",
    markerLabel: "PHYSICAL LENS",
    settleSeconds: 4,
    collectMs: 4_000,
    physicalLens: true,
  },
};

export function calibrationGuidePoint(
  target: CalibrationTarget,
  lensAnchor: { x: number; y: number },
): { x: number; y: number } {
  switch (target) {
    case "lens":
    case "head_left_eyes_lens":
    case "head_right_eyes_lens":
    case "head_down_eyes_lens":
      return lensAnchor;
    case "near_lens":
      return { x: lensAnchor.x, y: Math.min(0.18, lensAnchor.y + 0.07) };
    case "left":
      return { x: 0.12, y: 0.5 };
    case "right":
      return { x: 0.88, y: 0.5 };
    case "down":
      return { x: 0.5, y: 0.82 };
    case "above_lens":
      return { x: lensAnchor.x, y: 0.02 };
    case "screen_center":
      return { x: 0.5, y: 0.5 };
    case "self_preview":
      return { x: 0.24, y: 0.34 };
  }
}
