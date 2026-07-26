import { describe, expect, it } from "vitest";
import {
  buildCaptureCoreRecordRequest,
  captureCoreDeviceIds,
  captureProfileSchema,
  type CaptureProfile,
} from "../../../../packages/contracts/src";

const profile = (): CaptureProfile =>
  captureProfileSchema.parse({
    id: "p1",
    name: "Studio",
    kind: "studio_capture",
    cameraDeviceId: "webview-cam",
    cameraLabel: "Brio",
    microphoneDeviceId: "webview-mic",
    microphoneLabel: "Yeti",
    deviceBindings: {
      webviewCameraId: "webview-cam",
      avFoundationCameraId: "AV-BRIO",
      webviewMicrophoneId: "webview-mic",
      avFoundationMicrophoneId: "AV-YETI",
    },
    requestedVideo: { width: 1920, height: 1080, frameRate: 30 },
    negotiatedVideo: { width: 3840, height: 2160, frameRate: 30 },
    negotiatedAudio: { sampleRate: 48_000, channelCount: 1 },
    lensAnchor: { x: 0.5, y: 0.02 },
    updatedAt: "2026-07-26T12:00:00.000Z",
  });

describe("buildCaptureCoreRecordRequest", () => {
  it("maps AVFoundation IDs and negotiated media into request", () => {
    const req = buildCaptureCoreRecordRequest({
      sessionId: "s1",
      sessionRoot: "/tmp/s1",
      profile: profile(),
      maxDurationSec: 30,
      dryRun: true,
    });
    expect(req.cameraUniqueId).toBe("AV-BRIO");
    expect(req.microphoneUniqueId).toBe("AV-YETI");
    expect(req.video).toEqual({ width: 3840, height: 2160, frameRate: 30 });
    expect(req.audio).toEqual({ sampleRate: 48_000, channelCount: 1 });
    expect(req.dryRun).toBe(true);
    expect(req.maxDurationSec).toBe(30);
    expect(req.segmentDurationSec).toBe(10);
  });

  it("omits mic when videoOnly", () => {
    const req = buildCaptureCoreRecordRequest({
      sessionId: "s1",
      sessionRoot: "/tmp/s1",
      profile: profile(),
      videoOnly: true,
    });
    expect(req.microphoneUniqueId).toBeUndefined();
    expect(req.audio).toBeUndefined();
    expect(req.videoOnly).toBe(true);
  });

  it("device ids helper stays aligned", () => {
    expect(captureCoreDeviceIds(profile())).toEqual({
      cameraUniqueId: "AV-BRIO",
      microphoneUniqueId: "AV-YETI",
    });
  });
});
