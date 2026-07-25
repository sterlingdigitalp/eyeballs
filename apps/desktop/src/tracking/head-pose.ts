interface FacialTransformationMatrix {
  rows: number;
  columns: number;
  data: number[];
}

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

const normalize = (values: [number, number, number]): [number, number, number] => {
  const length = Math.hypot(...values);
  if (!Number.isFinite(length) || length < 1e-6) return [0, 0, 0];
  return values.map((value) => value / length) as [number, number, number];
};

/**
 * MediaPipe serializes its canonical-face transform in column-major order.
 * The upper-left 3×3 block is a scaled rotation. Normalize the basis columns
 * before extracting ZYX Euler angles so camera distance does not affect pose.
 */
export function headPoseFromFacialTransformation(
  matrix: FacialTransformationMatrix | undefined,
): HeadPose | undefined {
  if (
    !matrix ||
    matrix.rows < 3 ||
    matrix.columns < 3 ||
    matrix.data.length < matrix.rows * matrix.columns
  ) {
    return undefined;
  }
  const at = (row: number, column: number) =>
    matrix.data[column * matrix.rows + row];
  const column0 = normalize([at(0, 0), at(1, 0), at(2, 0)]);
  const column1 = normalize([at(0, 1), at(1, 1), at(2, 1)]);
  const column2 = normalize([at(0, 2), at(1, 2), at(2, 2)]);
  const [r00, r10, r20] = column0;
  const [, r11, r21] = column1;
  const [, r12, r22] = column2;
  const horizontalScale = Math.hypot(r00, r10);
  if (horizontalScale > 1e-6) {
    return {
      yaw: Math.atan2(-r20, horizontalScale),
      pitch: Math.atan2(r21, r22),
      roll: Math.atan2(r10, r00),
    };
  }
  return {
    yaw: Math.atan2(-r20, horizontalScale),
    pitch: Math.atan2(-r12, r11),
    roll: 0,
  };
}
