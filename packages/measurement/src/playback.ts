import type { GazePrediction, GazeState } from "../../contracts/src";

export function rebasePredictionTimestamps(
  predictions: GazePrediction[],
  sourceOriginUs: number,
  targetOriginUs: number,
): GazePrediction[] {
  if (!Number.isFinite(sourceOriginUs) || !Number.isFinite(targetOriginUs)) {
    throw new Error("Prediction timestamp origins must be finite.");
  }
  return predictions.map((prediction) => ({
    ...prediction,
    timestampUs: Math.max(
      0,
      Math.round(prediction.timestampUs - sourceOriginUs + targetOriginUs),
    ),
  }));
}

export interface PredictionTimelineSegment {
  state: GazeState;
  startUs: number;
  endUs: number;
  startRatio: number;
  widthRatio: number;
}

export function predictionAtPlaybackTime(
  predictions: GazePrediction[],
  monotonicStartUs: number,
  playbackSeconds: number,
): GazePrediction | undefined {
  if (!predictions.length || !Number.isFinite(playbackSeconds) || playbackSeconds < 0) {
    return undefined;
  }
  const targetUs = monotonicStartUs + Math.round(playbackSeconds * 1_000_000);
  let low = 0;
  let high = predictions.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (predictions[middle].timestampUs <= targetUs) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match >= 0 ? predictions[match] : undefined;
}

export function predictionTimelineSegments(
  predictions: GazePrediction[],
  monotonicStartUs: number,
  durationUs: number,
): PredictionTimelineSegment[] {
  if (!predictions.length || durationUs <= 0) return [];
  const sessionEndUs = monotonicStartUs + durationUs;
  const segments: Array<{ state: GazeState; startUs: number; endUs: number }> = [];
  for (let index = 0; index < predictions.length; index += 1) {
    const prediction = predictions[index];
    const startUs = Math.max(monotonicStartUs, prediction.timestampUs);
    const endUs = Math.min(
      sessionEndUs,
      predictions[index + 1]?.timestampUs ?? sessionEndUs,
    );
    if (endUs <= startUs) continue;
    const prior = segments[segments.length - 1];
    if (prior?.state === prediction.state && prior.endUs === startUs) {
      prior.endUs = endUs;
    } else {
      segments.push({ state: prediction.state, startUs, endUs });
    }
  }
  return segments.map((segment) => ({
    ...segment,
    startRatio: (segment.startUs - monotonicStartUs) / durationUs,
    widthRatio: (segment.endUs - segment.startUs) / durationUs,
  }));
}
