import { describe, expect, it, vi } from "vitest";
import { calibration } from "../../../../packages/measurement/src/test-fixtures";
import type { StoredSession } from "./store";
import {
  mergeStoredSessions,
  parseStoredSession,
  SessionWriteQueue,
} from "./session-store";

const session = (
  id: string,
  status: StoredSession["manifest"]["status"],
  frameCount: number,
  media?: Blob,
): StoredSession => ({
  manifest: {
    schemaVersion: "1.0.0",
    id,
    profileId: "profile",
    calibrationId: "calibration",
    trackerId: "tracker",
    trackerVersion: "1",
    algorithmVersion: "1",
    startedAt: new Date(Number(id) || 0).toISOString(),
    monotonicStartUs: 1_000,
    status,
    frameCount,
    droppedFrameCount: 0,
  },
  features: Array.from({ length: frameCount }, () => ({
    schemaVersion: "1.0.0",
    timestampUs: 1_000,
    confidence: 0.9,
    faceDetected: true,
    blink: false,
    eyeYaw: 0,
    eyePitch: 0,
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    faceScale: 0.3,
  })),
  predictions: [],
  events: [],
  corrections: [],
  media,
});

describe("session checkpoint merge", () => {
  it("serializes checkpoint writes and continues after a failed write", async () => {
    const queue = new SessionWriteQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.enqueue(async () => {
      order.push("first-start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first-end");
    });
    const second = queue.enqueue(async () => {
      order.push("second");
      throw new Error("expected");
    });
    const third = queue.enqueue(async () => {
      order.push("third");
    });
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst?.();
    await first;
    await expect(second).rejects.toThrow("expected");
    await third;
    expect(order).toEqual(["first-start", "first-end", "second", "third"]);
  });

  it("retains browser media while preferring a terminal native manifest", () => {
    const media = new Blob(["video"]);
    const browser = session("1", "recording", 40, media);
    browser.calibrationSnapshot = calibration();
    const native = session("1", "complete", 42);
    const [merged] = mergeStoredSessions([browser], [native]);
    expect(merged.manifest.status).toBe("complete");
    expect(merged.manifest.frameCount).toBe(42);
    expect(merged.media).toBe(media);
    expect(merged.calibrationSnapshot?.id).toBe(browser.calibrationSnapshot.id);
  });

  it("keeps the most complete arrays even if the other checkpoint has a later status", () => {
    const browser = session("1", "recording", 50);
    const native = session("1", "incomplete", 45);
    browser.cues = [{
      id: "cue-1",
      kind: "halo",
      timestampUs: 2_000,
      evidence: ["break_ms=1200"],
    }];
    browser.speakingWindows = [{ startUs: 2_000, endUs: 3_000 }];
    browser.bookmarks = [{
      id: "bookmark-1",
      sessionId: "1",
      timestampUs: 500,
      note: "Review this recovery",
      createdAt: "2026-07-26T12:00:00.000Z",
    }];
    const [merged] = mergeStoredSessions([browser], [native]);
    expect(merged.manifest.status).toBe("incomplete");
    expect(merged.features).toHaveLength(50);
    expect(merged.cues).toEqual(browser.cues);
    expect(merged.speakingWindows).toEqual(browser.speakingWindows);
    expect(merged.bookmarks).toEqual(browser.bookmarks);
  });

  it("keeps the richer native coaching evidence when browser evidence is stale", () => {
    const browser = session("1", "recording", 40);
    browser.cues = [];
    browser.speakingWindows = [{ startUs: 2_000, endUs: 3_000 }];
    const native = session("1", "complete", 42);
    native.cues = [
      {
        id: "cue-1",
        kind: "quiet_sound",
        timestampUs: 2_500,
        evidence: ["break_ms=1400"],
      },
    ];
    native.speakingWindows = [
      { startUs: 2_000, endUs: 3_000 },
      { startUs: 4_000, endUs: 6_000 },
    ];
    const [merged] = mergeStoredSessions([browser], [native]);
    expect(merged.cues).toEqual(native.cues);
    expect(merged.speakingWindows).toEqual(native.speakingWindows);
  });

  it("keeps original and corrected transcript revisions separate", () => {
    const browser = session("1", "complete", 42);
    browser.transcript = {
      sessionId: "1",
      modelVersion: "whisper/1",
      origin: "model",
      words: [{ text: "Hello.", startUs: 0, endUs: 400_000 }],
      sentences: [{ index: 0, startUs: 0, endUs: 400_000, text: "Hello." }],
      updatedAt: "2026-07-26T12:00:00.000Z",
    };
    browser.correctedTranscript = {
      ...browser.transcript,
      origin: "user_corrected",
      sentences: [{ index: 0, startUs: 0, endUs: 500_000, text: "Hello." }],
      updatedAt: "2026-07-26T12:02:00.000Z",
    };
    const native = session("1", "complete", 42);
    native.transcript = browser.transcript;
    native.correctedTranscript = {
      ...browser.correctedTranscript,
      sentences: [{ index: 0, startUs: 0, endUs: 450_000, text: "Hello." }],
      updatedAt: "2026-07-26T12:01:00.000Z",
    };
    const [merged] = mergeStoredSessions([browser], [native]);
    expect(merged.transcript?.origin).toBe("model");
    expect(merged.correctedTranscript?.sentences[0].endUs).toBe(500_000);
  });

  it("returns unique sessions newest first", () => {
    const merged = mergeStoredSessions(
      [session("1", "complete", 1)],
      [session("2", "incomplete", 2)],
    );
    expect(merged.map((value) => value.manifest.id)).toEqual(["2", "1"]);
  });

  it("keeps a readable manifest visible when stored evidence is malformed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const damaged = {
      ...session("1", "complete", 1),
      predictions: [{ impossible: true }],
    };
    const parsed = parseStoredSession(damaged);
    expect(parsed?.manifest.status).toBe("invalid");
    expect(parsed?.manifest.recoveryNote).toMatch(/schema validation/);
    expect(parsed?.predictions).toEqual([]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
