import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  Calibration,
  CalibrationTarget,
  FeatureVector,
} from "../../packages/contracts/src";
import { calibrationSchema } from "../../packages/contracts/src";

type RawPoint = [number, number, number, number];
type GazePoint = number[];

const databasePath =
  process.argv[2] ??
  join(
    homedir(),
    "Library",
    "Application Support",
    "com.sterlingdigital.camerapresence",
    "presence.sqlite3",
  );
const calibrationOffset = Math.max(
  0,
  Number.parseInt(process.argv[3] ?? "0", 10) || 0,
);

const rows = JSON.parse(
  execFileSync(
    "sqlite3",
    [
      "-json",
      databasePath,
      `SELECT value_json FROM json_records WHERE bucket='calibrations' ORDER BY updated_at DESC LIMIT 1 OFFSET ${calibrationOffset};`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ),
) as Array<{ value_json: string }>;

const calibration = calibrationSchema.parse(
  JSON.parse(rows[0]?.value_json ?? "{}"),
);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
};

const rawPoint = (feature: FeatureVector): RawPoint => [
  feature.eyeYaw,
  feature.eyePitch,
  feature.headYaw,
  feature.headPitch,
];

const center = (samples: Calibration["samples"]): RawPoint =>
  [0, 1, 2, 3].map((index) =>
    median(samples.map((sample) => rawPoint(sample.feature)[index])),
  ) as RawPoint;

const usableTraining = calibration.samples.filter(
  (sample) =>
    sample.feature.faceDetected &&
    !sample.feature.blink &&
    sample.feature.confidence >= 0.65,
);
const byTarget = new Map<CalibrationTarget, Calibration["samples"]>();
for (const sample of usableTraining) {
  byTarget.set(sample.target, [...(byTarget.get(sample.target) ?? []), sample]);
}

const lensCenter = center(byTarget.get("lens") ?? []);
const headLeftCenter = center(byTarget.get("head_left_eyes_lens") ?? []);
const headRightCenter = center(byTarget.get("head_right_eyes_lens") ?? []);
const headDownCenter = center(byTarget.get("head_down_eyes_lens") ?? []);
const ratio = (
  baseEye: number,
  targetEye: number,
  baseHead: number,
  targetHead: number,
): number | undefined => {
  const denominator = targetHead - baseHead;
  if (Math.abs(denominator) < 0.05) return undefined;
  return (baseEye - targetEye) / denominator;
};
const yawCompensation = median(
  [
    ratio(lensCenter[0], headLeftCenter[0], lensCenter[2], headLeftCenter[2]),
    ratio(lensCenter[0], headRightCenter[0], lensCenter[2], headRightCenter[2]),
  ].filter((value): value is number => value !== undefined),
);
const pitchCompensation =
  ratio(lensCenter[1], headDownCenter[1], lensCenter[3], headDownCenter[3]) ?? 0;

const gazePoint = (feature: FeatureVector, headWeight: number): GazePoint => [
  feature.eyeYaw + yawCompensation * feature.headYaw,
  feature.eyePitch + pitchCompensation * feature.headPitch,
  feature.headYaw * headWeight,
  feature.headPitch * headWeight,
];
const gazeCenter = (
  samples: Calibration["samples"],
  headWeight: number,
): GazePoint =>
  [0, 1, 2, 3].map((index) =>
    median(
      samples.map((sample) => gazePoint(sample.feature, headWeight)[index]),
    ),
  );
const distance = (a: GazePoint, b: GazePoint): number =>
  Math.hypot(...a.map((value, index) => value - b[index]));
const contactTarget = (target: CalibrationTarget): boolean =>
  target === "lens" ||
  target === "near_lens" ||
  target === "above_lens" ||
  target.startsWith("head_");

const prototypeTargets = [
  "lens",
  "left",
  "right",
  "down",
  "screen_center",
  "self_preview",
  "head_left_eyes_lens",
  "head_right_eyes_lens",
  "head_down_eyes_lens",
] as const satisfies readonly CalibrationTarget[];
const compare = (headWeight: number) => {
  const prototypes = prototypeTargets.map((target) => ({
    target,
    contact: contactTarget(target),
    point: gazeCenter(byTarget.get(target) ?? [], headWeight),
  }));
  const counts: Record<
    string,
    { correct: number; evaluated: number; accuracy?: number }
  > = {};
  let correct = 0;
  let evaluated = 0;
  for (const sample of calibration.validationSamples ?? []) {
    if (
      sample.feature.blink ||
      !sample.feature.faceDetected ||
      sample.feature.confidence < 0.55
    ) {
      continue;
    }
    const point = gazePoint(sample.feature, headWeight);
    const predicted = prototypes
      .map((prototype) => ({
        ...prototype,
        distance: distance(point, prototype.point),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    const target = (counts[sample.target] ??= { correct: 0, evaluated: 0 });
    target.evaluated += 1;
    evaluated += 1;
    if (predicted && predicted.contact === contactTarget(sample.target)) {
      target.correct += 1;
      correct += 1;
    }
  }
  for (const value of Object.values(counts)) {
    value.accuracy = value.evaluated ? value.correct / value.evaluated : 0;
  }
  return {
    headWeight,
    accuracy: evaluated ? correct / evaluated : 0,
    byTarget: counts,
    prototypes,
  };
};

console.info(
  JSON.stringify(
    {
      calibrationId: calibration.id,
      yawCompensation,
      pitchCompensation,
      comparisons: [0, 0.1, 0.2, 0.3, 0.45].map(compare),
    },
    null,
    2,
  ),
);
