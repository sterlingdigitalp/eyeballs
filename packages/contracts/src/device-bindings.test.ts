import { describe, expect, it } from "vitest";
import {
  captureCoreDeviceIds,
  captureProfileSchema,
  type CaptureProfile,
} from "./index";

const base = (): CaptureProfile =>
  captureProfileSchema.parse({
    id: "p1",
    name: "Test",
    kind: "custom",
    cameraDeviceId: "webview-cam",
    cameraLabel: "Cam",
    microphoneDeviceId: "webview-mic",
    microphoneLabel: "Mic",
    requestedVideo: { width: 1280, height: 720, frameRate: 30 },
    lensAnchor: { x: 0.5, y: 0.02 },
    updatedAt: "2026-07-26T12:00:00.000Z",
  });

describe("deviceBindings for CaptureCore", () => {
  it("prefers AVFoundation uniqueIDs when present", () => {
    const profile = {
      ...base(),
      deviceBindings: {
        webviewCameraId: "webview-cam",
        avFoundationCameraId: "AV-CAM-1",
        webviewMicrophoneId: "webview-mic",
        avFoundationMicrophoneId: "AV-MIC-1",
      },
    };
    expect(captureCoreDeviceIds(profile)).toEqual({
      cameraUniqueId: "AV-CAM-1",
      microphoneUniqueId: "AV-MIC-1",
    });
  });

  it("falls back to legacy profile device fields", () => {
    expect(captureCoreDeviceIds(base())).toEqual({
      cameraUniqueId: "webview-cam",
      microphoneUniqueId: "webview-mic",
    });
  });
});
