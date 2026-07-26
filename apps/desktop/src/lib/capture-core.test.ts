import { describe, expect, it } from "vitest";
import {
  buildCaptureCoreRecordRequest,
  CAPTURE_CORE_VERTICAL_SLICE_SEC,
  captureCoreDeviceIds,
  captureProfileSchema,
  isCaptureCoreVerticalSliceComplete,
  type CaptureProfile,
} from "../../../../packages/contracts/src";
import { previewFrameFromEvent, summarizeCaptureCoreEvent } from "./capture-core";

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

describe("summarizeCaptureCoreEvent", () => {
  it("summarizes health and state events", () => {
    expect(
      summarizeCaptureCoreEvent({ type: "state", payload: { state: "recording" } }),
    ).toBe("State: recording");
    expect(
      summarizeCaptureCoreEvent({
        type: "health",
        payload: { videoFrames: 12, segmentIndex: 0 },
      }),
    ).toContain("12 frames");
  });
});

describe("Stage 4 vertical slice gate", () => {
  it("uses 30s charter duration constant", () => {
    expect(CAPTURE_CORE_VERTICAL_SLICE_SEC).toBe(30);
  });

  it("accepts sealed hashed run results", () => {
    expect(
      isCaptureCoreVerticalSliceComplete({
        exitCode: 0,
        sealPath: "/tmp/session-seal.json",
        segmentHashes: [{ sha256: "a".repeat(64), byteLength: 12 }],
      }),
    ).toBe(true);
    expect(
      isCaptureCoreVerticalSliceComplete({
        exitCode: 0,
        sealPath: null,
        segmentHashes: [{ sha256: "a".repeat(64), byteLength: 12 }],
      }),
    ).toBe(false);
  });
});

describe("Stage 5 preview transport", () => {
  it("summarizes preview_frame events", () => {
    expect(
      summarizeCaptureCoreEvent({
        type: "preview_frame",
        payload: { jpegBytes: 1200, encodeMs: 2.5 },
      }),
    ).toContain("1200 bytes");
  });

  it("maps preview_frame to a display path", () => {
    const frame = previewFrameFromEvent({
      type: "preview_frame",
      payload: {
        path: "/tmp/session/preview/latest.jpg",
        sequence: 3,
        width: 640,
        height: 360,
        jpegBytes: 9000,
      },
    });
    expect(frame?.path).toBe("/tmp/session/preview/latest.jpg");
    expect(frame?.sequence).toBe(3);
    // Outside Tauri, displaySrc is the raw path; under Tauri it becomes convertFileSrc + ?s=
    expect(frame?.displaySrc).toContain("latest.jpg");
    expect(frame?.width).toBe(640);
  });
});
