import { describe, expect, it } from "vitest";
import type { CaptureProfile, DeviceInventory } from "../../../../packages/contracts/src";
import {
  describeMediaError,
  cameraConstraints,
  reconcileProfileLabels,
  stopMediaStream,
  suggestProfiles,
} from "./devices";

const device = (kind: MediaDeviceKind, label: string, deviceId: string): MediaDeviceInfo => ({
  kind,
  label,
  deviceId,
  groupId: `${deviceId}-group`,
  toJSON: () => ({ kind, label, deviceId }),
});

describe("capture profile matching", () => {
  it("seeds both first-class profiles only from matching hardware", () => {
    const inventory: DeviceInventory = {
      cameras: [
        device("videoinput", "MacBook Pro Camera", "builtin-camera"),
        device("videoinput", "Logitech BRIO 4K", "brio"),
      ],
      microphones: [
        device("audioinput", "MacBook Pro Microphone", "builtin-mic"),
        device("audioinput", "Yeti Stereo Microphone", "yeti"),
      ],
      cameraPermission: "granted",
      microphonePermission: "granted",
    };
    const profiles = suggestProfiles(inventory);
    expect(profiles.map((profile) => profile.name)).toEqual(["MacBook Practice", "Studio Capture"]);
    expect(profiles[1].requestedVideo).toEqual({ width: 3840, height: 2160, frameRate: 30 });
  });

  it("builds camera constraints from the selected profile instead of assuming 1080p", () => {
    expect(cameraConstraints("brio", {
      width: 3840,
      height: 2160,
      frameRate: 30,
    })).toEqual({
      video: {
        deviceId: { exact: "brio" },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
  });

  it("does not invent a Studio profile when the Yeti is missing", () => {
    const inventory: DeviceInventory = {
      cameras: [device("videoinput", "Logitech BRIO 4K", "brio")],
      microphones: [device("audioinput", "MacBook Pro Microphone", "builtin-mic")],
      cameraPermission: "granted",
      microphonePermission: "granted",
    };
    expect(suggestProfiles(inventory)).toEqual([]);
  });

  it("turns permission and device errors into deterministic recovery guidance", () => {
    expect(describeMediaError("camera", new DOMException("denied", "NotAllowedError"))).toMatch(
      /System Settings/,
    );
    expect(describeMediaError("microphone", new DOMException("missing", "NotFoundError"))).toMatch(
      /no longer connected/,
    );
    expect(describeMediaError("camera", new DOMException("busy", "NotReadableError"))).toMatch(
      /another application/,
    );
  });

  it("stops every track when a profile releases its streams", () => {
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [
        { stop: () => stopped.push("video") },
        { stop: () => stopped.push("audio") },
      ],
    } as unknown as MediaStream;
    stopMediaStream(stream);
    expect(stopped).toEqual(["video", "audio"]);
    expect(() => stopMediaStream(undefined)).not.toThrow();
  });

  it("refreshes renamed device labels while preserving stable IDs", () => {
    const profile: CaptureProfile = {
      id: "profile",
      name: "Studio Capture",
      kind: "studio_capture",
      cameraDeviceId: "camera-stable",
      cameraLabel: "Old camera name",
      microphoneDeviceId: "microphone-stable",
      microphoneLabel: "Old microphone name",
      requestedVideo: { width: 3840, height: 2160, frameRate: 30 },
      lensAnchor: { x: 0.5, y: 0.015 },
      updatedAt: new Date(0).toISOString(),
    };
    const inventory: DeviceInventory = {
      cameras: [device("videoinput", "Logitech BRIO", "camera-stable")],
      microphones: [device("audioinput", "Yeti Stereo Microphone", "microphone-stable")],
      cameraPermission: "granted",
      microphonePermission: "granted",
    };
    const [updated] = reconcileProfileLabels([profile], inventory);
    expect(updated.cameraDeviceId).toBe("camera-stable");
    expect(updated.microphoneDeviceId).toBe("microphone-stable");
    expect(updated.cameraLabel).toBe("Logitech BRIO");
    expect(updated.microphoneLabel).toBe("Yeti Stereo Microphone");
  });
});
