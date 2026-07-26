import { describe, expect, it } from "vitest";
import type { GazePrediction, SessionManifest } from "../../contracts/src";
import { loadBuiltinDrills } from "./drills";
import {
  applyRecommendationFeedback,
  recommendationAwaitingUsefulness,
  recommendNext,
  RECOMMENDATION_RULES_VERSION,
} from "./recommendations";

const prediction = (
  timestampUs: number,
  state: GazePrediction["state"],
  confidence = 0.9,
): GazePrediction => ({
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

function baseLatest(
  overrides: Partial<SessionManifest["coaching"]> = {},
  predictions?: GazePrediction[],
) {
  const frames =
    predictions ??
    Array.from({ length: 40 }, (_, index) =>
      prediction(index * 100_000, index % 5 === 0 ? "off_lens" : "contact"),
    );
  const manifest: SessionManifest = {
    schemaVersion: "1.0.0",
    id: "rec-session",
    profileId: "profile",
    calibrationId: "cal",
    trackerId: "t",
    trackerVersion: "1",
    algorithmVersion: "a",
    startedAt: "2026-07-25T12:00:00.000Z",
    monotonicStartUs: 0,
    status: "complete",
    frameCount: frames.length,
    droppedFrameCount: 0,
    coaching: {
      drillId: "relaxed-lens-hold-01",
      drillVersion: "1",
      curriculumLevel: 1,
      feedbackIntensity: "standard",
      scoringPolicyVersion: "coaching-scoring/1.0.0",
      ...overrides,
    },
  };
  return {
    manifest,
    predictions: frames,
    events: frames
      .filter((frame) => frame.state === "off_lens")
      .map((frame, index) => ({
        id: `b${index}`,
        type: "break" as const,
        startUs: frame.timestampUs,
        endUs: frame.timestampUs + 2_500_000,
        confidence: 0.8,
      })),
  };
}

describe("deterministic recommendations", () => {
  it("includes a reason and refuses harder drills when tracking is poor", () => {
    const poorFrames = Array.from({ length: 40 }, (_, index) =>
      prediction(index * 100_000, "unknown", 0.2),
    );
    const recommendation = recommendNext({
      latest: baseLatest({}, poorFrames),
      availableDrills: loadBuiltinDrills(),
    });
    expect(recommendation.action).toBe("recalibrate");
    expect(recommendation.reason.toLowerCase()).toMatch(/recalibrat/);
    expect(recommendation.reason.length).toBeGreaterThan(20);
    expect(recommendation.rulesVersion).toBe(RECOMMENDATION_RULES_VERSION);
    expect(recommendation.evidence.some((item) => item.includes("poor_tracking"))).toBe(true);
    expect(recommendation.drillId).toBeUndefined();
  });

  it("recommends note-return style drill for long breaks", () => {
    const frames = Array.from({ length: 60 }, (_, index) =>
      prediction(index * 200_000, index % 3 === 0 ? "off_lens" : "contact", 0.9),
    );
    const latest = baseLatest({ curriculumLevel: 3 }, frames);
    latest.events = frames
      .filter((frame) => frame.state === "off_lens")
      .map((frame, index) => ({
        id: `b${index}`,
        type: "break" as const,
        startUs: frame.timestampUs,
        endUs: frame.timestampUs + 2_200_000,
        confidence: 0.85,
      }));
    const recommendation = recommendNext({
      latest,
      availableDrills: loadBuiltinDrills(),
    });
    expect(recommendation.action).toBe("drill");
    expect(recommendation.reason).toMatch(/notes|recover|break/i);
    expect(recommendation.drillId).toBeTruthy();
  });

  it("records dismiss/pin/follow feedback without changing the rule reason", () => {
    const base = recommendNext({
      latest: baseLatest(),
      availableDrills: loadBuiltinDrills(),
    });
    const updated = applyRecommendationFeedback(base, {
      dismissed: true,
      pinned: false,
      followed: true,
      useful: false,
    });
    expect(updated.dismissed).toBe(true);
    expect(updated.followed).toBe(true);
    expect(updated.useful).toBe(false);
    expect(updated.reason).toBe(base.reason);
  });

  it("does not treat following as useful until a resulting session exists and is rated", () => {
    const followed = {
      id: "rf-return-from-notes",
      recommendationId: "return-from-notes",
      drillId: "notes-and-recover-01",
      followed: true,
      updatedAt: "2026-07-26T12:00:00.000Z",
    };
    expect(
      recommendationAwaitingUsefulness([followed], []),
    ).toBeUndefined();
    expect(
      recommendationAwaitingUsefulness(
        [followed],
        ["return-from-notes"],
      ),
    ).toEqual(followed);
    expect(
      recommendationAwaitingUsefulness(
        [{ ...followed, useful: false }],
        ["return-from-notes"],
      ),
    ).toBeUndefined();
  });
});
