import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { calibrationSchema } from "../../packages/contracts/src";
import {
  calibrationQualityGate,
  evaluateHeldOutCalibration,
} from "../../packages/measurement/src/calibration";
import {
  ALGORITHM_VERSION,
  classifyFrame,
  trainClassifier,
} from "../../packages/measurement/src/classifier";
import {
  MEDIAPIPE_TRACKER_ID,
  MEDIAPIPE_TRACKER_VERSION,
} from "../../apps/desktop/src/tracking/mediapipe";

const databasePath =
  process.argv[2] ??
  join(
    homedir(),
    "Library",
    "Application Support",
    "com.sterlingdigital.camerapresence",
    "presence.sqlite3",
  );

const rows = JSON.parse(execFileSync("sqlite3", [
  "-json",
  databasePath,
  "SELECT value_json FROM json_records WHERE bucket='calibrations' ORDER BY updated_at DESC;",
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })) as Array<{ value_json: string }>;

const report = rows.map(({ value_json }) => {
  const calibration = calibrationSchema.parse(JSON.parse(value_json));
  const heldOut = evaluateHeldOutCalibration(calibration);
  const gate = calibrationQualityGate(heldOut.accuracy, heldOut.byTarget);
  const model = trainClassifier({
    ...calibration,
    samples: heldOut.trainingSamples,
  });
  const predictionCounts = heldOut.validationSamples.reduce<
    Record<string, Record<string, number>>
  >((counts, sample) => {
    if (
      sample.feature.blink ||
      !sample.feature.faceDetected ||
      sample.feature.confidence < 0.55
    ) {
      return counts;
    }
    const predicted = classifyFrame(model, sample.feature).rawState;
    counts[sample.target] ??= {};
    counts[sample.target][predicted] =
      (counts[sample.target][predicted] ?? 0) + 1;
    return counts;
  }, {});
  return {
    id: calibration.id,
    profileId: calibration.profileId,
    createdAt: calibration.createdAt,
    storedInvalidated: Boolean(calibration.invalidatedAt),
    compatibleWithCurrentAlgorithm: calibration.algorithmVersion === ALGORITHM_VERSION,
    compatibleWithCurrentTracker:
      calibration.trackerId === MEDIAPIPE_TRACKER_ID &&
      calibration.trackerVersion === MEDIAPIPE_TRACKER_VERSION,
    eligibleByStoredMetadata:
      !calibration.invalidatedAt &&
      calibration.algorithmVersion === ALGORITHM_VERSION &&
      calibration.trackerId === MEDIAPIPE_TRACKER_ID &&
      calibration.trackerVersion === MEDIAPIPE_TRACKER_VERSION,
    trackerId: calibration.trackerId,
    trackerVersion: calibration.trackerVersion,
    currentRequiredTrackerId: MEDIAPIPE_TRACKER_ID,
    currentRequiredTrackerVersion: MEDIAPIPE_TRACKER_VERSION,
    storedAlgorithmVersion: calibration.algorithmVersion,
    evaluatedAlgorithmVersion: ALGORITHM_VERSION,
    protocolVersion: calibration.protocolVersion ?? "legacy-target-split/1",
    trainingSamples: heldOut.trainingSamples.length,
    validationSamples: heldOut.validationSamples.length,
    accuracy: heldOut.accuracy,
    byTarget: heldOut.byTarget,
    predictionCounts,
    prototypes: model.prototypes,
    contactRadius: model.contactRadius,
    gate,
  };
});

console.info(JSON.stringify(report, null, 2));
