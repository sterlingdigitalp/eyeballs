import { describe, expect, it } from "vitest";
import type { StoredSession } from "../../../apps/desktop/src/lib/store";
import { recordingFinalization, recoverInterruptedSession } from "./recovery";

const session = (status: StoredSession["manifest"]["status"]): StoredSession => ({
  manifest: {
    schemaVersion: "1.0.0",
    id: "session",
    profileId: "profile",
    calibrationId: "calibration",
    trackerId: "tracker",
    trackerVersion: "1",
    algorithmVersion: "1",
    startedAt: new Date(0).toISOString(),
    monotonicStartUs: 100,
    status,
    frameCount: 4,
    droppedFrameCount: 0,
  },
  features: [],
  predictions: [],
  events: [],
  corrections: [],
});

describe("session recovery", () => {
  it.each(["recording", "finalizing"] as const)("marks stale %s sessions incomplete", (status) => {
    const recovered = recoverInterruptedSession(session(status));
    expect(recovered.changed).toBe(true);
    expect(recovered.session.manifest.status).toBe("incomplete");
    expect(recovered.session.manifest.recoveryNote).toMatch(/stopped before finalization/);
  });

  it("does not rewrite a completed session", () => {
    const recovered = recoverInterruptedSession(session("complete"));
    expect(recovered.changed).toBe(false);
    expect(recovered.session.manifest.status).toBe("complete");
  });

  it("refuses to mark an empty requested recording complete", () => {
    expect(recordingFinalization(true, 0).status).toBe("incomplete");
    expect(recordingFinalization(false, 0).status).toBe("complete");
    expect(recordingFinalization(true, 1024).status).toBe("complete");
  });
});
