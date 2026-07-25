import type { CaptureProfile, DeviceInventory } from "../../../../packages/contracts/src";

async function permissionState(name: "camera" | "microphone"): Promise<PermissionState | "unsupported"> {
  try {
    return (await navigator.permissions.query({ name: name as PermissionName })).state;
  } catch {
    return "unsupported";
  }
}

export async function enumerateDevices(): Promise<DeviceInventory> {
  if (!navigator.mediaDevices) throw new Error("Media devices are unavailable in this runtime.");
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((device) => device.kind === "videoinput"),
    microphones: devices.filter((device) => device.kind === "audioinput"),
    cameraPermission: await permissionState("camera"),
    microphonePermission: await permissionState("microphone"),
  };
}

export function cameraConstraints(
  deviceId?: string,
  requested: CaptureProfile["requestedVideo"] = {
    width: 1920,
    height: 1080,
    frameRate: 30,
  },
): MediaStreamConstraints {
  return {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: requested.width },
      height: { ideal: requested.height },
      frameRate: { ideal: requested.frameRate },
    },
    audio: false,
  };
}

export async function requestCamera(
  deviceId?: string,
  requested?: CaptureProfile["requestedVideo"],
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(cameraConstraints(deviceId, requested));
}

export async function requestMicrophone(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: false,
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: { ideal: 48_000 },
      channelCount: { ideal: 1 },
    },
  });
}

export function stopMediaStream(stream?: MediaStream): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function reconcileProfileLabels(
  profiles: CaptureProfile[],
  inventory: DeviceInventory,
): CaptureProfile[] {
  return profiles.map((profile) => {
    const cameraLabel =
      inventory.cameras.find((device) => device.deviceId === profile.cameraDeviceId)?.label ||
      profile.cameraLabel;
    const microphoneLabel =
      inventory.microphones.find((device) => device.deviceId === profile.microphoneDeviceId)?.label ||
      profile.microphoneLabel;
    if (cameraLabel === profile.cameraLabel && microphoneLabel === profile.microphoneLabel) {
      return profile;
    }
    return {
      ...profile,
      cameraLabel,
      microphoneLabel,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function describeMediaError(kind: "camera" | "microphone", cause: unknown): string {
  if (!(cause instanceof DOMException)) return `${kind} access failed: ${String(cause)}`;
  const label = kind[0].toUpperCase() + kind.slice(1);
  if (cause.name === "NotAllowedError" || cause.name === "SecurityError") {
    return `${label} permission was denied or revoked. Enable it in System Settings → Privacy & Security, then retry.`;
  }
  if (cause.name === "NotFoundError") return `The selected ${kind} is no longer connected.`;
  if (cause.name === "NotReadableError" || cause.name === "AbortError") {
    return `${label} is unavailable or in use by another application.`;
  }
  if (cause.name === "OverconstrainedError") {
    return `${label} could not provide the requested format. Choose another profile or device.`;
  }
  return `${label} access failed: ${cause.message || cause.name}`;
}

export function negotiatedProfile(
  profile: CaptureProfile,
  camera: MediaStreamTrack,
  microphone?: MediaStreamTrack,
): CaptureProfile {
  const video = camera.getSettings();
  const audio = microphone?.getSettings();
  return {
    ...profile,
    negotiatedVideo: {
      width: video.width ?? profile.requestedVideo.width,
      height: video.height ?? profile.requestedVideo.height,
      frameRate: video.frameRate ?? profile.requestedVideo.frameRate,
    },
    negotiatedAudio: audio
      ? { sampleRate: audio.sampleRate ?? 48_000, channelCount: audio.channelCount ?? 1 }
      : profile.negotiatedAudio,
    updatedAt: new Date().toISOString(),
  };
}

export function suggestProfiles(inventory: DeviceInventory): CaptureProfile[] {
  const now = new Date().toISOString();
  const builtinCamera = inventory.cameras.find((device) => /facetime|built.?in|macbook.*camera/i.test(device.label));
  const builtinMic = inventory.microphones.find((device) => /macbook|built.?in/i.test(device.label));
  const brio = inventory.cameras.find((device) => /brio|v-u0040/i.test(device.label));
  const yeti = inventory.microphones.find((device) => /yeti|a00132/i.test(device.label));
  const profiles: CaptureProfile[] = [];
  if (builtinCamera && builtinMic) {
    profiles.push({
      id: crypto.randomUUID(),
      name: "MacBook Practice",
      kind: "macbook_practice",
      cameraDeviceId: builtinCamera.deviceId,
      cameraLabel: builtinCamera.label,
      microphoneDeviceId: builtinMic.deviceId,
      microphoneLabel: builtinMic.label,
      requestedVideo: { width: 1920, height: 1080, frameRate: 30 },
      lensAnchor: { x: 0.5, y: 0.015 },
      updatedAt: now,
    });
  }
  if (brio && yeti) {
    profiles.push({
      id: crypto.randomUUID(),
      name: "Studio Capture",
      kind: "studio_capture",
      cameraDeviceId: brio.deviceId,
      cameraLabel: brio.label,
      microphoneDeviceId: yeti.deviceId,
      microphoneLabel: yeti.label,
      requestedVideo: { width: 3840, height: 2160, frameRate: 30 },
      lensAnchor: { x: 0.5, y: 0.015 },
      updatedAt: now,
    });
  }
  return profiles;
}
