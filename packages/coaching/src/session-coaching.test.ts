import { describe, expect, it } from "vitest";
import type { CueEvent, SessionManifest } from "../../contracts/src";
import { parseDrillDefinition } from "./drills";
import {
  applyReflectionToSession,
  rateSessionCue,
} from "./session-coaching";
import {
  beginCountdown,
  createTrainSession,
  finishReflection,
  requestStop,
  tickActive,
  tickCountdown,
} from "./train-session";
import { speakingSeconds, type SpeakingWindow } from "./speaking";
import level3 from "../content/drills/level3-prompted-response.json";

const baseManifest = (): SessionManifest => ({
  schemaVersion: "1.0.0",
  id: "sess-reflect",
  profileId: "p1",
  calibrationId: "c1",
  trackerId: "t",
  trackerVersion: "1",
  algorithmVersion: "a",
  startedAt: "2026-07-25T12:00:00.000Z",
  endedAt: "2026-07-25T12:01:00.000Z",
  monotonicStartUs: 0,
  status: "complete",
  frameCount: 100,
  droppedFrameCount: 0,
  coaching: {
    drillId: "prompted-response-01",
    drillVersion: "1",
    curriculumLevel: 3,
    feedbackIntensity: "standard",
    scoringPolicyVersion: "coaching-scoring/1.0.0",
    completed: false,
  },
});

describe("session coaching persistence helpers", () => {
  it("persists completed, reflectionNotes, and comfortAfter after reflection", () => {
    const drill = parseDrillDefinition(level3);
    let train = createTrainSession({
      drill,
      feedbackIntensity: "standard",
      record: false,
      comfortBefore: 2,
      sessionGoal: "Answer clearly",
    });
    train = beginCountdown(train);
    train = tickCountdown(train);
    train = tickCountdown(train);
    train = tickCountdown(train);
    train = tickActive(train, 45);
    train = requestStop(train);

    // Simulate finalized session before reflection (completed still false).
    const pre = {
      manifest: {
        ...baseManifest(),
        coaching: {
          ...baseManifest().coaching!,
          completed: false,
          comfortBefore: 2,
          sessionGoal: "Answer clearly",
        },
      },
      cues: [] as CueEvent[],
    };
    expect(pre.manifest.coaching?.completed).toBe(false);
    expect(pre.manifest.coaching?.reflectionNotes).toBeUndefined();

    const speakingWindows: SpeakingWindow[] = [
      { startUs: 0, endUs: 25_000_000 },
    ];
    const speakingSec = speakingSeconds(speakingWindows);
    expect(speakingSec).toBeGreaterThanOrEqual(20);

    const finished = finishReflection(
      train,
      ["Felt good returning to the lens"],
      5,
      speakingSec,
    );
    expect(finished.completed).toBe(true);

    const persisted = applyReflectionToSession(pre, finished);
    expect(persisted.manifest.coaching?.completed).toBe(true);
    expect(persisted.manifest.coaching?.comfortAfter).toBe(5);
    expect(persisted.manifest.coaching?.reflectionNotes).toEqual([
      "Felt good returning to the lens",
    ]);
    expect(persisted.manifest.id).toBe("sess-reflect");
  });

  it("does not mark completed when speaking seconds are below drill minimum", () => {
    const drill = parseDrillDefinition(level3);
    let train = createTrainSession({
      drill,
      feedbackIntensity: "standard",
      record: false,
    });
    train = beginCountdown(train);
    for (let i = 0; i < 3; i += 1) train = tickCountdown(train);
    train = tickActive(train, 45);
    train = requestStop(train);
    const finished = finishReflection(train, [], 3, 5);
    expect(finished.completed).toBe(false);
    const persisted = applyReflectionToSession(
      { manifest: baseManifest(), cues: [] },
      finished,
    );
    expect(persisted.manifest.coaching?.completed).toBe(false);
  });

  it("stores user cue ratings on the shipped cue log", () => {
    const cues: CueEvent[] = [
      {
        id: "cue-1",
        kind: "halo",
        timestampUs: 1_000_000,
        evidence: ["break_ms=1000"],
      },
      {
        id: "cue-2",
        kind: "pulse",
        timestampUs: 2_000_000,
        evidence: ["break_ms=2000"],
      },
    ];
    const session = { manifest: baseManifest(), cues };
    const rated = rateSessionCue(session, "cue-1", "unnecessary");
    expect(rated.cues?.[0].rating).toBe("unnecessary");
    expect(rated.cues?.[1].rating).toBeUndefined();
    const helpful = rateSessionCue(rated, "cue-2", "helpful");
    expect(helpful.cues?.[1].rating).toBe("helpful");
  });
});
