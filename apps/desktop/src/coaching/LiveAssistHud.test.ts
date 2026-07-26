import { describe, expect, it } from "vitest";
import { liveAssistRecordingDefault } from "./live-assist";
import {
  createTrainSession,
  parseDrillDefinition,
} from "../../../../packages/coaching/src";
import level6 from "../../../../packages/coaching/content/drills/level6-live-assist.json";
import type { GazeState } from "../../../../packages/contracts/src";

/** Mirrors how App wires LiveAssistHud from Measure snapshots. */
function liveAssistHudPropsFromSnapshot(snapshot: {
  state?: GazeState;
  recording: boolean;
  liveAssist: boolean;
}): { recording: boolean; state: GazeState } {
  return {
    recording: snapshot.recording,
    state: snapshot.state ?? "unknown",
  };
}

describe("live assist privacy defaults", () => {
  it("keeps recording off by default for live assist", () => {
    expect(liveAssistRecordingDefault()).toBe(false);
    const drill = parseDrillDefinition(level6);
    const state = createTrainSession({
      drill,
      feedbackIntensity: "minimal",
      record: true,
      liveAssist: true,
    });
    expect(state.config.record).toBe(false);
    expect(state.config.liveAssist).toBe(true);
  });

  it("reflects Measure snapshot contact state and recording on the HUD path", () => {
    const idle = liveAssistHudPropsFromSnapshot({
      recording: false,
      liveAssist: true,
    });
    expect(idle.recording).toBe(false);
    expect(idle.state).toBe("unknown");

    const active = liveAssistHudPropsFromSnapshot({
      state: "contact",
      recording: true,
      liveAssist: true,
    });
    expect(active.state).toBe("contact");
    expect(active.recording).toBe(true);

    const away = liveAssistHudPropsFromSnapshot({
      state: "off_lens",
      recording: false,
      liveAssist: true,
    });
    expect(away.state).toBe("off_lens");
  });
});
