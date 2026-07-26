import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureCoreDeviceIds,
  captureProfileSchema,
  matchAvFoundationDevice,
  reconcileDeviceBindings,
  shortSha256,
  type CaptureCoreDeviceInventory,
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

const inventory = (): CaptureCoreDeviceInventory => ({
  protocolVersion: "1.0.0",
  generatedAt: "2026-07-26T12:00:00.000Z",
  cameras: [
    {
      uniqueId: "AV-BRIO",
      name: "Logitech BRIO",
      manufacturer: "Logitech",
      kind: "camera",
    },
    {
      uniqueId: "AV-FACE",
      name: "FaceTime HD Camera",
      manufacturer: "Apple",
      kind: "camera",
    },
  ],
  microphones: [
    {
      uniqueId: "AV-YETI",
      name: "Yeti Stereo Microphone",
      manufacturer: "Blue",
      kind: "microphone",
    },
  ],
});

describe("deviceBindings for CaptureCore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("matches AVFoundation devices by label", () => {
    expect(matchAvFoundationDevice("Logitech BRIO", inventory().cameras)?.uniqueId).toBe(
      "AV-BRIO",
    );
    expect(matchAvFoundationDevice("yeti", inventory().microphones)?.uniqueId).toBe("AV-YETI");
  });

  it("reconcileDeviceBindings fills avFoundation ids from labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T15:00:00.000Z"));
    const profile = {
      ...base(),
      cameraLabel: "Logitech BRIO",
      microphoneLabel: "Yeti Stereo Microphone",
    };
    const next = reconcileDeviceBindings(profile, inventory());
    expect(next.deviceBindings).toEqual({
      webviewCameraId: "webview-cam",
      webviewMicrophoneId: "webview-mic",
      avFoundationCameraId: "AV-BRIO",
      avFoundationMicrophoneId: "AV-YETI",
    });
    expect(captureCoreDeviceIds(next).cameraUniqueId).toBe("AV-BRIO");
  });

  it("shortSha256 abbreviates digests", () => {
    const hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(shortSha256(hex)).toBe("ba7816bf…f20015ad");
  });
});
