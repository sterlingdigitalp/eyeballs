import type { Calibration, FeatureVector, GazePrediction } from "../../contracts/src";
import {
  ALGORITHM_VERSION,
  classifyFrame,
  trainClassifier,
} from "../../measurement/src/classifier";

export const OFFLINE_FACE_WORKER_ID = "offline-face-worker/1.0.0";

export interface OfflineFaceResult {
  workerId: string;
  modelVersion: string;
  algorithmVersion: string;
  features: FeatureVector[];
  predictions: GazePrediction[];
  /** Explicitly no identity embeddings in Phase 3 default path. */
  identityEmbeddings: null;
  meanConfidence: number;
}

/**
 * Offline reprocess using versioned measurement contracts.
 * Does not create identity embeddings.
 */
export function reprocessOfflineFace(
  calibration: Calibration,
  features: FeatureVector[],
  modelVersion = OFFLINE_FACE_WORKER_ID,
): OfflineFaceResult {
  const model = trainClassifier(calibration);
  const predictions = features.map((feature) => classifyFrame(model, feature));
  const meanConfidence = predictions.length
    ? predictions.reduce((sum, prediction) => sum + prediction.confidence, 0) /
      predictions.length
    : 0;
  return {
    workerId: OFFLINE_FACE_WORKER_ID,
    modelVersion,
    algorithmVersion: ALGORITHM_VERSION,
    features,
    predictions,
    identityEmbeddings: null,
    meanConfidence,
  };
}
