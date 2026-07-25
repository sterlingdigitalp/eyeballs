import { describe, expect, it } from "vitest";
import { headPoseFromFacialTransformation } from "./head-pose";

const matrix = (yaw: number, pitch: number, roll: number, scale = 1) => {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const rowMajor = [
    cr * cy,
    cr * sy * sp - sr * cp,
    cr * sy * cp + sr * sp,
    0,
    sr * cy,
    sr * sy * sp + cr * cp,
    sr * sy * cp - cr * sp,
    0,
    -sy,
    cy * sp,
    cy * cp,
    0,
    0,
    0,
    0,
    1,
  ];
  return {
    rows: 4,
    columns: 4,
    data: Array.from({ length: 16 }, (_, index) => {
      const row = index % 4;
      const column = Math.floor(index / 4);
      const value = rowMajor[row * 4 + column];
      return row < 3 && column < 3 ? value * scale : value;
    }),
  };
};

describe("MediaPipe head pose", () => {
  it("extracts neutral pose from a column-major transform", () => {
    const pose = headPoseFromFacialTransformation(matrix(0, 0, 0, 2.4));
    expect(pose?.yaw).toBeCloseTo(0);
    expect(pose?.pitch).toBeCloseTo(0);
    expect(pose?.roll).toBeCloseTo(0);
  });

  it("recovers yaw, pitch, and roll independently of transform scale", () => {
    const pose = headPoseFromFacialTransformation(matrix(0.22, -0.14, 0.09, 3.1));
    expect(pose?.yaw).toBeCloseTo(0.22, 5);
    expect(pose?.pitch).toBeCloseTo(-0.14, 5);
    expect(pose?.roll).toBeCloseTo(0.09, 5);
  });

  it("returns undefined for a malformed transform", () => {
    expect(headPoseFromFacialTransformation({ rows: 4, columns: 4, data: [] })).toBeUndefined();
  });
});
