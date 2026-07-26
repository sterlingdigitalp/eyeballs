import { describe, expect, it } from "vitest";
import type { GazeEvent, GazePrediction, SessionManifest } from "../../contracts/src";
import {
  comparableKeyString,
  computeSessionTrendPoint,
  groupComparableSessions,
  measurementDegradationNotes,
} from "./progress";

const prediction = (timestampUs: number, state: GazePrediction["state"], confidence = 0.9): GazePrediction => ({
  timestampUs,
  state,
  confidence,
  rawState: state,
  blinkSuppressed: false,
  calibrationId: "c",
  trackerId: "t",
  trackerVersion: "1",
  algorithmVersion: "a",
});

const session = (
  id: string,
  coaching: SessionManifest["coaching"],
  profileId = "profile-a",
): { manifest: SessionManifest; predictions: GazePrediction[]; events: GazeEvent[] } => ({
  manifest: {
    schemaVersion: "1.0.0",
    id,
    profileId,
    calibrationId: "cal",
    trackerId: "t",
    trackerVersion: "1",
    algorithmVersion: "a",
    startedAt: `2026-07-25T1${id}:00:00.000Z`.replace(/\D/g, "").length
      ? `2026-07-25T12:0${id.slice(-1)}:00.000Z`
      : "2026-07-25T12:00:00.000Z",
    monotonicStartUs: 0,
    status: "complete",
    frameCount: 4,
    droppedFrameCount: 0,
    coaching,
  },
  predictions: [
    prediction(0, "contact"),
    prediction(1_000_000, "off_lens"),
    prediction(2_000_000, "contact"),
    prediction(3_000_000, "contact"),
  ],
  events: [
    { id: "b", type: "break", startUs: 1_000_000, endUs: 2_000_000, confidence: 0.8 },
    { id: "r", type: "recovery", startUs: 2_000_000, endUs: 2_000_000, confidence: 0.9 },
  ],
});

const coaching = (
  drillId: string,
  feedbackIntensity: "standard" | "minimal" | "active" = "standard",
) => ({
  drillId,
  drillVersion: "1",
  curriculumLevel: 1 as const,
  feedbackIntensity,
  scoringPolicyVersion: "coaching-scoring/1.0.0",
  comfortBefore: 3,
  comfortAfter: 4,
});

describe("progress grouping and trends", () => {
  it("groups only like-for-like sessions (drill + profile + feedback + scoring policy)", () => {
    const sessions = [
      session("1", coaching("relaxed-lens-hold-01", "standard")),
      session("2", coaching("relaxed-lens-hold-01", "standard")),
      session("3", coaching("relaxed-lens-hold-01", "minimal")),
      session("4", coaching("prompted-response-01", "standard")),
      session("5", coaching("relaxed-lens-hold-01", "standard"), "profile-b"),
    ];
    // Fix timestamps for ordering
    sessions[0].manifest.startedAt = "2026-07-25T12:00:00.000Z";
    sessions[1].manifest.startedAt = "2026-07-25T13:00:00.000Z";
    sessions[2].manifest.startedAt = "2026-07-25T14:00:00.000Z";
    sessions[3].manifest.startedAt = "2026-07-25T15:00:00.000Z";
    sessions[4].manifest.startedAt = "2026-07-25T16:00:00.000Z";

    const groups = groupComparableSessions(sessions);
    const standardA = groups.find(
      (group) =>
        group.key.drillId === "relaxed-lens-hold-01" &&
        group.key.feedbackIntensity === "standard" &&
        group.key.profileId === "profile-a",
    );
    expect(standardA?.points).toHaveLength(2);
    expect(standardA?.baselineSessionId).toBe("1");
    // contactDuringSpeaking requires speaking windows; absent → omitted from trends
    expect(standardA?.trends.contactDuringSpeaking.length).toBe(0);
    expect(standardA?.trends.breaksPerMinute.length).toBe(2);

    // Different feedback intensity is a separate series
    expect(
      groups.some(
        (group) =>
          group.key.drillId === "relaxed-lens-hold-01" &&
          group.key.feedbackIntensity === "minimal",
      ),
    ).toBe(true);

    // Different drill and profile do not merge into the standard/profile-a series
    expect(
      groups.find(
        (group) =>
          group.key.drillId === "prompted-response-01" &&
          group.key.profileId === "profile-a",
      )?.points,
    ).toHaveLength(1);
    expect(
      groups.find(
        (group) =>
          group.key.drillId === "relaxed-lens-hold-01" &&
          group.key.profileId === "profile-b",
      )?.points,
    ).toHaveLength(1);
    expect(groups.length).toBeGreaterThanOrEqual(4);
  });

  it("computes understandable multi-metric trends without a single opaque score", () => {
    const base = session("9", coaching("relaxed-lens-hold-01"));
    // Without speaking windows, contactDuringSpeaking is null (do not invent speech).
    const withoutSpeech = computeSessionTrendPoint(base);
    expect(withoutSpeech.contactDuringSpeaking).toBeNull();
    expect(withoutSpeech.breaksPerMinute).not.toBeNull();
    expect(withoutSpeech.medianBreakMs).toBe(1000);
    // Recovery is 0 ms when recovery starts at break endUs (evidence-based, not hard-coded 250).
    expect(withoutSpeech.recoveryMs).toBe(0);
    expect(withoutSpeech.comfortAfter).toBe(4);
    expect(withoutSpeech.measurementDegraded).toBe(false);

    const withSpeech = computeSessionTrendPoint({
      ...base,
      speakingWindows: [{ startUs: 0, endUs: 500_000 }, { startUs: 2_000_000, endUs: 3_500_000 }],
    });
    // Frames at 0 (contact) and 2_000_000/3_000_000 (contact) are in windows; 1_000_000 off_lens excluded by window end.
    expect(withSpeech.contactDuringSpeaking).toBe(1);
  });

  it("flags measurement degradation separately from performance", () => {
    const degraded = session("d", coaching("relaxed-lens-hold-01"));
    degraded.predictions = [
      prediction(0, "unknown", 0.2),
      prediction(1_000_000, "unknown", 0.2),
      prediction(2_000_000, "unknown", 0.2),
      prediction(3_000_000, "contact", 0.4),
    ];
    const series = groupComparableSessions([degraded])[0];
    expect(series.points[0].measurementDegraded).toBe(true);
    const notes = measurementDegradationNotes(series);
    expect(notes[0]).toMatch(/weak tracking/i);
    expect(comparableKeyString(series.key)).toContain("relaxed-lens-hold-01");
  });
});
