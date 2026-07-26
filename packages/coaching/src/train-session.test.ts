import { describe, expect, it } from "vitest";
import type { SessionManifest } from "../../contracts/src";
import { parseDrillDefinition } from "./drills";
import {
  beginCountdown,
  buildCoachedManifest,
  createTrainSession,
  defaultRecordingIntent,
  drillCompletionMet,
  emergencyStop,
  finishReflection,
  recordingStateLabel,
  requestStop,
  restartSafeRecordingFlag,
  tickActive,
  tickCountdown,
} from "./train-session";
import level1 from "../content/drills/level1-relaxed-lens-hold.json";
import level6 from "../content/drills/level6-live-assist.json";

const baseManifest = (): SessionManifest => ({
  schemaVersion: "1.0.0",
  id: "s1",
  profileId: "p1",
  calibrationId: "c1",
  trackerId: "t",
  trackerVersion: "1",
  algorithmVersion: "a",
  startedAt: "2026-07-25T12:00:00.000Z",
  monotonicStartUs: 1000,
  status: "recording",
  frameCount: 0,
  droppedFrameCount: 0,
});

describe("train session loop", () => {
  const drill = parseDrillDefinition(level1);
  const live = parseDrillDefinition(level6);

  it("runs countdown → active → reflect → complete with goals and intensity stamped", () => {
    let state = createTrainSession({
      drill,
      feedbackIntensity: "review_only",
      sessionGoal: "Stay soft on the lens",
      comfortBefore: 2,
      record: true,
    });
    expect(recordingStateLabel(state)).toBe("NOT RECORDING");
    state = beginCountdown(state);
    expect(state.phase).toBe("countdown");
    state = tickCountdown(state);
    state = tickCountdown(state);
    state = tickCountdown(state);
    expect(state.phase).toBe("active");
    expect(state.recording).toBe(true);
    expect(recordingStateLabel(state)).toBe("RECORDING");
    state = tickActive(state, 25);
    state = requestStop(state);
    expect(state.phase).toBe("reflect");
    expect(state.recording).toBe(false);
    state = finishReflection(state, ["Felt natural"], 4, 0);
    expect(state.phase).toBe("complete");
    expect(state.completed).toBe(true);

    const manifest = buildCoachedManifest(baseManifest(), state);
    expect(manifest.coaching?.drillId).toBe(drill.id);
    expect(manifest.coaching?.feedbackIntensity).toBe("review_only");
    expect(manifest.coaching?.sessionGoal).toBe("Stay soft on the lens");
    expect(manifest.coaching?.comfortAfter).toBe(4);
    expect(manifest.coaching?.reflectionNotes).toEqual(["Felt natural"]);
    expect(manifest.coaching?.completed).toBe(true);
  });

  it("emergency stop is always available and clears recording", () => {
    let state = createTrainSession({
      drill,
      feedbackIntensity: "standard",
      record: true,
    });
    state = beginCountdown(state);
    state = tickCountdown(state);
    state = tickCountdown(state);
    state = tickCountdown(state);
    expect(state.phase).toBe("active");
    state = emergencyStop(state);
    expect(state.phase).toBe("stopped");
    expect(state.emergencyStopped).toBe(true);
    expect(state.recording).toBe(false);
    expect(recordingStateLabel(state)).toBe("NOT RECORDING");
    state = finishReflection(state, [], 1, 0);
    expect(state.completed).toBe(false);
  });

  it("live assist defaults recording off with unmistakable privacy label", () => {
    const state = createTrainSession({
      drill: live,
      feedbackIntensity: "minimal",
      record: true,
      liveAssist: true,
    });
    expect(state.config.record).toBe(false);
    expect(recordingStateLabel(state)).toBe("LIVE ASSIST — NOT RECORDING");
    expect(defaultRecordingIntent(live)).toBe(false);
  });

  it("never resumes recording after restart", () => {
    expect(restartSafeRecordingFlag({ recording: true })).toBe(false);
    expect(restartSafeRecordingFlag(null)).toBe(false);
  });

  it("evaluates completion against drill minimums", () => {
    expect(drillCompletionMet(drill, 10, 0)).toBe(false);
    expect(drillCompletionMet(drill, 20, 0)).toBe(true);
  });
});
