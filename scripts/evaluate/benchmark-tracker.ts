import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  calibrationTargetSchema,
  featureVectorSchema,
  sessionManifestSchema,
  type Calibration,
} from "../../packages/contracts/src";
import {
  calibrationSamplesFromIntervals,
  correctionsFromIntervals,
  summarizeCalibrationStability,
  summarizeTrackerFeatures,
} from "../../packages/measurement/src/benchmark";
import {
  ALGORITHM_VERSION,
  classifyFrame,
  TemporalClassifier,
  trainClassifier,
} from "../../packages/measurement/src/classifier";
import {
  calculateConfusionMatrix,
  calculateEventTiming,
} from "../../packages/measurement/src/evaluation";

const configSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  originUs: z.number().int().nonnegative().optional(),
  calibrationIntervals: z.array(z.object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    target: calibrationTargetSchema,
  })),
  evaluationIntervals: z.array(z.object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    label: z.enum(["contact", "not_contact", "unknown"]),
    note: z.string().optional(),
  })),
});

const [, , featurePath, labelPath, outputPath] = process.argv;
if (!featurePath || !labelPath || !outputPath) {
  console.error(
    "Usage: npm run benchmark:tracker -- <features.jsonl> <labels.json> <output.json>",
  );
  process.exit(2);
}

const featureText = await readFile(featurePath, "utf8");
let rawRecords: Array<Record<string, unknown>>;
let inputManifest: z.infer<typeof sessionManifestSchema> | undefined;
let featureDocument: unknown;
try {
  featureDocument = JSON.parse(featureText) as unknown;
} catch {
  featureDocument = undefined;
}
if (Array.isArray(featureDocument)) {
  rawRecords = featureDocument as Array<Record<string, unknown>>;
} else if (
  featureDocument &&
  typeof featureDocument === "object" &&
  Array.isArray((featureDocument as { features?: unknown }).features)
) {
  rawRecords = (featureDocument as { features: Array<Record<string, unknown>> }).features;
  const manifest = (featureDocument as { manifest?: unknown }).manifest;
  if (manifest) inputManifest = sessionManifestSchema.parse(manifest);
} else {
  rawRecords = featureText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
const features = rawRecords.map((record) => featureVectorSchema.parse(record));
if (!features.length) throw new Error("Tracker feature file is empty.");
const config = configSchema.parse(JSON.parse(await readFile(labelPath, "utf8")));
const originUs = config.originUs ?? features[0].timestampUs;
const samples = calibrationSamplesFromIntervals(
  features,
  originUs,
  config.calibrationIntervals,
);
if (!samples.some((sample) => sample.target === "lens")) {
  throw new Error("Benchmark calibration intervals need physical-lens samples.");
}
if (!samples.some((sample) => !sample.target.includes("lens"))) {
  throw new Error("Benchmark calibration intervals need off-lens samples.");
}

const providerId = inputManifest?.trackerId ??
  String(rawRecords[0].providerId ?? "unknown-provider");
const providerVersion = inputManifest?.trackerVersion ??
  String(rawRecords[0].modelVersion ?? "unknown-version");
const featureSummary = summarizeTrackerFeatures(features);
const faceRecords = rawRecords.filter((record) => record.faceDetected === true);
const hasExplicitPupilOutput = rawRecords.some((record) => "leftPupilX" in record);
const pupilDetectionRate = hasExplicitPupilOutput
  ? faceRecords.filter(
      (record) =>
        typeof record.leftPupilX === "number" &&
        typeof record.leftPupilY === "number" &&
        typeof record.rightPupilX === "number" &&
        typeof record.rightPupilY === "number",
    ).length / Math.max(1, faceRecords.length)
  : providerId === "mediapipe-face-landmarker"
    ? featureSummary.detectionRate
    : undefined;
const calibration: Calibration = {
  id: `benchmark-${providerId}`,
  profileId: "same-corpus-benchmark",
  trackerId: providerId,
  trackerVersion: providerVersion,
  featureSchemaVersion: "1.0.0",
  algorithmVersion: ALGORITHM_VERSION,
  protocolVersion: "same-corpus-labels/1.0.0",
  createdAt: new Date(0).toISOString(),
  setupFingerprint: {
    cameraDeviceId: "recorded-corpus",
    width: 1,
    height: 1,
    frameRate: 1,
    lensAnchorX: 0.5,
    lensAnchorY: 0,
  },
  samples,
  quality: {
    score: 1,
    sampleCount: samples.length,
    warnings: [],
    heldOutAccuracy: 0,
  },
};
const model = trainClassifier(calibration);
const temporal = new TemporalClassifier();
const predictions = features.map((feature) =>
  temporal.update(classifyFrame(model, feature)),
);
const corrections = correctionsFromIntervals(
  "same-corpus-benchmark",
  originUs,
  config.evaluationIntervals,
);
const output = {
  schemaVersion: "1.0.0",
  sourceFeatures: featurePath,
  sourceLabels: labelPath,
  sourceSessionId: inputManifest?.id,
  providerId,
  providerVersion,
  algorithmVersion: ALGORITHM_VERSION,
  predictionOriginUs: originUs,
  featureSummary: {
    ...featureSummary,
    pupilDetectionRate,
  },
  stabilityByCalibrationInterval: summarizeCalibrationStability(
    features,
    originUs,
    config.calibrationIntervals,
  ),
  metrics: calculateConfusionMatrix(predictions, corrections),
  eventTiming: calculateEventTiming(predictions, corrections),
  calibrationSampleCount: samples.length,
  predictionCount: predictions.length,
  predictions,
};
await writeFile(outputPath, JSON.stringify(output, null, 2));
console.info(JSON.stringify(output, null, 2));
