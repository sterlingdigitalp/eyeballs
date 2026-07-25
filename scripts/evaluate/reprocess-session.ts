import { readFile, writeFile } from "node:fs/promises";
import {
  calibrationSchema,
  featureVectorSchema,
  sessionManifestSchema,
} from "../../packages/contracts/src";
import { classifyFrame, TemporalClassifier, trainClassifier } from "../../packages/measurement/src/classifier";

const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 && arguments_.length !== 3) {
  console.error(
    "Usage: npm run reprocess -- <session.json> [calibration.json] <output.json>",
  );
  process.exit(2);
}
const [sessionPath, calibrationPath, outputPath] = arguments_.length === 3
  ? arguments_
  : [arguments_[0], undefined, arguments_[1]];

const session = JSON.parse(await readFile(sessionPath, "utf8")) as {
  features?: unknown[];
  manifest?: unknown;
  calibrationSnapshot?: unknown;
};
const calibrationSource = calibrationPath
  ? JSON.parse(await readFile(calibrationPath, "utf8"))
  : session.calibrationSnapshot;
if (!calibrationSource) {
  throw new Error(
    "Session has no embedded calibration snapshot; provide its calibration JSON explicitly.",
  );
}
const calibration = calibrationSchema.parse(calibrationSource);
const manifest = session.manifest
  ? sessionManifestSchema.parse(session.manifest)
  : undefined;
if (
  manifest &&
  (
    manifest.trackerId !== calibration.trackerId ||
    manifest.trackerVersion !== calibration.trackerVersion
  )
) {
  throw new Error(
    `Tracker mismatch: session uses ${manifest.trackerId}/${manifest.trackerVersion}, ` +
      `but calibration uses ${calibration.trackerId}/${calibration.trackerVersion}. ` +
      "Use the same-corpus tracker benchmark for cross-provider comparisons.",
  );
}
const features = (session.features ?? []).map((value) => featureVectorSchema.parse(value));
if (!features.length) throw new Error("Session contains no tracking features.");
const model = trainClassifier(calibration);
const temporal = new TemporalClassifier();
const predictions = features.map((feature) => temporal.update(classifyFrame(model, feature)));

await writeFile(outputPath, JSON.stringify({
  schemaVersion: "1.0.0",
  sourceSession: sessionPath,
  sourceSessionId: manifest?.id,
  sourceCalibration: calibrationPath ?? `embedded:${calibration.id}`,
  algorithmVersion: predictions[0]?.algorithmVersion ?? "unknown",
  trackerId: calibration.trackerId,
  trackerVersion: calibration.trackerVersion,
  predictionOriginUs:
    manifest?.monotonicStartUs ?? features[0].timestampUs,
  predictions,
}, null, 2));

console.info(`Reprocessed ${predictions.length} frames to ${outputPath}.`);
