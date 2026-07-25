import { describe, expect, it } from "vitest";
import type { GazePrediction, GazeState } from "../../contracts/src";
import {
  predictionAtPlaybackTime,
  predictionTimelineSegments,
  rebasePredictionTimestamps,
} from "./playback";

const prediction = (timestampUs: number, state: GazeState): GazePrediction => ({
  timestampUs,
  state,
  rawState: state,
  confidence: 0.9,
  blinkSuppressed: false,
  calibrationId: "calibration",
  trackerId: "tracker",
  trackerVersion: "1",
  algorithmVersion: "1",
});

describe("review playback alignment", () => {
  it("rebases relative provider timestamps onto a recorded session clock", () => {
    const values = rebasePredictionTimestamps(
      [prediction(500_000, "contact"), prediction(1_500_000, "off_lens")],
      500_000,
      80_000_000,
    );
    expect(values.map((value) => value.timestampUs)).toEqual([
      80_000_000,
      81_000_000,
    ]);
  });

  const startUs = 10_000_000;
  const predictions = [
    prediction(startUs + 100_000, "unknown"),
    prediction(startUs + 500_000, "contact"),
    prediction(startUs + 1_500_000, "contact"),
    prediction(startUs + 2_000_000, "off_lens"),
  ];

  it("finds the latest prediction on or before the playback clock", () => {
    expect(predictionAtPlaybackTime(predictions, startUs, 0.05)).toBeUndefined();
    expect(predictionAtPlaybackTime(predictions, startUs, 0.5)?.state).toBe("contact");
    expect(predictionAtPlaybackTime(predictions, startUs, 1.9)?.state).toBe("contact");
    expect(predictionAtPlaybackTime(predictions, startUs, 2)?.state).toBe("off_lens");
  });

  it("uses monotonic durations and merges adjacent equal states", () => {
    const segments = predictionTimelineSegments(predictions, startUs, 3_000_000);
    expect(segments.map((segment) => segment.state)).toEqual([
      "unknown",
      "contact",
      "off_lens",
    ]);
    expect(segments[0]).toMatchObject({ startRatio: 0.1 / 3, widthRatio: 0.4 / 3 });
    expect(segments[1]).toMatchObject({ startRatio: 0.5 / 3, widthRatio: 1.5 / 3 });
    expect(segments[2]).toMatchObject({ startRatio: 2 / 3, widthRatio: 1 / 3 });
  });

  it("returns no segments for an invalid or empty duration", () => {
    expect(predictionTimelineSegments(predictions, startUs, 0)).toEqual([]);
    expect(predictionTimelineSegments([], startUs, 1_000_000)).toEqual([]);
  });
});
