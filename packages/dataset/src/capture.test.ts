import { describe, expect, it } from "vitest";
import {
  applyCaptureBytes,
  captureHealthDegraded,
  isMasterRole,
  planMasterAssets,
  sessionPaths,
} from "./capture";

describe("production master capture planning", () => {
  it("creates durable master video/audio asset identities with timestamps", () => {
    const paths = sessionPaths("sess-a");
    const assets = planMasterAssets(
      {
        sessionId: "sess-a",
        negotiatedVideo: { width: 1920, height: 1080, frameRate: 30 },
        negotiatedAudio: { sampleRate: 48_000, channelCount: 2 },
        videoMonotonicStartUs: 1_000_000,
        audioMonotonicStartUs: 1_002_000,
        relativeMasterVideoPath: paths.masterVideo,
        relativeMasterAudioPath: paths.masterAudio,
      },
      "2026-07-25T12:00:00.000Z",
    );
    expect(assets).toHaveLength(2);
    expect(assets[0].role).toBe("master_video");
    expect(assets[0].immutable).toBe(true);
    expect(assets[0].monotonicStartUs).toBe(1_000_000);
    expect(assets[0].relativePath).toContain("master/video.mov");
    expect(assets[1].role).toBe("master_audio");
    expect(isMasterRole(assets[0].role)).toBe(true);
  });

  it("records byte length and hash without clearing immutable flag", () => {
    const [video] = planMasterAssets(
      {
        sessionId: "s",
        negotiatedVideo: { width: 1280, height: 720, frameRate: 30 },
        videoMonotonicStartUs: 0,
        relativeMasterVideoPath: "sessions/s/master/video.mov",
      },
      "2026-07-25T12:00:00.000Z",
    );
    const sealed = applyCaptureBytes(video, 1_024_000, "abc123hash", 5_000_000);
    expect(sealed.sha256).toBe("abc123hash");
    expect(sealed.validationState).toBe("valid");
    expect(sealed.immutable).toBe(true);
    expect(sealed.id).toBe(video.id);
  });

  it("flags capture health under drop or disk pressure", () => {
    expect(
      captureHealthDegraded({
        droppedVideoFrames: 0,
        droppedAudioBuffers: 0,
        encoderBackpressureEvents: 0,
        diskFreeBytes: 1e12,
        diskPressure: false,
      }),
    ).toBe(false);
    expect(
      captureHealthDegraded({
        droppedVideoFrames: 100,
        droppedAudioBuffers: 0,
        encoderBackpressureEvents: 0,
        diskFreeBytes: 1e6,
        diskPressure: true,
      }),
    ).toBe(true);
  });
});
