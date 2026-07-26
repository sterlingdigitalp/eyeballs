import { z } from "zod";

export const gazeStates = ["contact", "near_lens", "off_lens", "unknown"] as const;
export type GazeState = (typeof gazeStates)[number];

export const featureFlagsSchema = z.object({
  experimentalTrackerComparison: z.boolean(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

/** Webview MediaDeviceInfo.deviceId and AVFoundation uniqueID are not the same. */
export const deviceBindingsSchema = z.object({
  webviewCameraId: z.string().optional(),
  avFoundationCameraId: z.string().optional(),
  webviewMicrophoneId: z.string().optional(),
  avFoundationMicrophoneId: z.string().optional(),
});
export type DeviceBindings = z.infer<typeof deviceBindingsSchema>;

export const captureProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["macbook_practice", "studio_capture", "custom"]),
  cameraDeviceId: z.string(),
  cameraLabel: z.string(),
  microphoneDeviceId: z.string(),
  microphoneLabel: z.string(),
  /** Optional dual-provider device identity for CaptureCore vs webview. */
  deviceBindings: deviceBindingsSchema.optional(),
  requestedVideo: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive(),
  }),
  negotiatedVideo: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      frameRate: z.number().positive(),
    })
    .optional(),
  negotiatedAudio: z
    .object({
      sampleRate: z.number().positive(),
      channelCount: z.number().int().positive(),
    })
    .optional(),
  captureDiagnostics: z
    .object({
      cameraRequestLatencyMs: z.number().nonnegative(),
      timeToFirstFrameMs: z.number().nonnegative(),
      measuredAt: z.string().datetime(),
    })
    .optional(),
  lensAnchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  updatedAt: z.string().datetime(),
});
export type CaptureProfile = z.infer<typeof captureProfileSchema>;

/** Build CaptureCore request device IDs from a profile (prefers AVFoundation bindings). */
export function captureCoreDeviceIds(profile: CaptureProfile): {
  cameraUniqueId: string;
  microphoneUniqueId?: string;
} {
  const camera =
    profile.deviceBindings?.avFoundationCameraId ||
    profile.deviceBindings?.webviewCameraId ||
    profile.cameraDeviceId;
  const mic =
    profile.deviceBindings?.avFoundationMicrophoneId ||
    profile.deviceBindings?.webviewMicrophoneId ||
    (profile.microphoneDeviceId || undefined);
  return {
    cameraUniqueId: camera,
    microphoneUniqueId: mic || undefined,
  };
}

/** CaptureCore JSONL protocol version (Swift + Rust + TS). */
export const CAPTURE_CORE_PROTOCOL_VERSION = "1.0.0" as const;

export const captureCoreRecordRequestSchema = z.object({
  sessionId: z.string().min(1),
  sessionRoot: z.string().min(1),
  cameraUniqueId: z.string().min(1),
  microphoneUniqueId: z.string().optional(),
  video: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive(),
  }),
  audio: z
    .object({
      sampleRate: z.number().positive(),
      channelCount: z.number().int().positive(),
    })
    .optional(),
  segmentDurationSec: z.number().positive().optional(),
  maxDurationSec: z.number().positive().optional(),
  videoOnly: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
export type CaptureCoreRecordRequest = z.infer<typeof captureCoreRecordRequestSchema>;

export const captureCoreSegmentHashSchema = z.object({
  path: z.string(),
  sha256: z.string().length(64),
  byteLength: z.number().int().nonnegative(),
});
export type CaptureCoreSegmentHash = z.infer<typeof captureCoreSegmentHashSchema>;

export const captureCoreRunResultSchema = z.object({
  exitCode: z.number().int(),
  events: z.array(z.record(z.string(), z.unknown())),
  segmentHashes: z.array(captureCoreSegmentHashSchema),
  sessionRoot: z.string(),
  dryRun: z.boolean(),
  sealPath: z.string().optional().nullable(),
});
export type CaptureCoreRunResult = z.infer<typeof captureCoreRunResultSchema>;

export const captureCoreDeviceOutSchema = z.object({
  uniqueId: z.string(),
  name: z.string(),
  manufacturer: z.string(),
  kind: z.string(),
});
export type CaptureCoreDeviceOut = z.infer<typeof captureCoreDeviceOutSchema>;

export const captureCoreDeviceInventorySchema = z.object({
  protocolVersion: z.string(),
  generatedAt: z.string(),
  cameras: z.array(captureCoreDeviceOutSchema),
  microphones: z.array(captureCoreDeviceOutSchema),
});
export type CaptureCoreDeviceInventory = z.infer<typeof captureCoreDeviceInventorySchema>;

/** Build a CaptureCore record request from a profile + session paths. */
export function buildCaptureCoreRecordRequest(input: {
  sessionId: string;
  sessionRoot: string;
  profile: CaptureProfile;
  maxDurationSec?: number;
  segmentDurationSec?: number;
  dryRun?: boolean;
  videoOnly?: boolean;
}): CaptureCoreRecordRequest {
  const ids = captureCoreDeviceIds(input.profile);
  const video = input.profile.negotiatedVideo ?? input.profile.requestedVideo;
  const audio = input.profile.negotiatedAudio;
  return captureCoreRecordRequestSchema.parse({
    sessionId: input.sessionId,
    sessionRoot: input.sessionRoot,
    cameraUniqueId: ids.cameraUniqueId,
    microphoneUniqueId: input.videoOnly ? undefined : ids.microphoneUniqueId,
    video: {
      width: video.width,
      height: video.height,
      frameRate: video.frameRate,
    },
    audio:
      input.videoOnly || !audio
        ? undefined
        : {
            sampleRate: audio.sampleRate,
            channelCount: audio.channelCount,
          },
    maxDurationSec: input.maxDurationSec,
    segmentDurationSec: input.segmentDurationSec,
    videoOnly: input.videoOnly,
    dryRun: input.dryRun,
  });
}

function normalizeDeviceLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Match a webview/profile label to an AVFoundation device by stable uniqueId
 * (if already bound) or localized name (exact, then unique substring).
 */
export function matchAvFoundationDevice(
  label: string,
  devices: CaptureCoreDeviceOut[],
  preferredUniqueId?: string,
): CaptureCoreDeviceOut | undefined {
  if (preferredUniqueId) {
    const byId = devices.find((device) => device.uniqueId === preferredUniqueId);
    if (byId) return byId;
  }
  const needle = normalizeDeviceLabel(label);
  if (!needle) return undefined;
  const exact = devices.filter((device) => normalizeDeviceLabel(device.name) === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const partial = devices.filter((device) => {
    const name = normalizeDeviceLabel(device.name);
    return name.includes(needle) || needle.includes(name);
  });
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * Fill `deviceBindings` from CaptureCore list-devices inventory using profile labels.
 * Does not invent IDs when the match is ambiguous.
 */
export function reconcileDeviceBindings(
  profile: CaptureProfile,
  inventory: CaptureCoreDeviceInventory,
): CaptureProfile {
  const prev = profile.deviceBindings ?? {};
  const camera = matchAvFoundationDevice(
    profile.cameraLabel || profile.cameraDeviceId,
    inventory.cameras,
    prev.avFoundationCameraId,
  );
  const microphone = matchAvFoundationDevice(
    profile.microphoneLabel || profile.microphoneDeviceId,
    inventory.microphones,
    prev.avFoundationMicrophoneId,
  );
  const deviceBindings = {
    webviewCameraId: prev.webviewCameraId ?? profile.cameraDeviceId,
    webviewMicrophoneId: prev.webviewMicrophoneId ?? profile.microphoneDeviceId,
    avFoundationCameraId: camera?.uniqueId ?? prev.avFoundationCameraId,
    avFoundationMicrophoneId: microphone?.uniqueId ?? prev.avFoundationMicrophoneId,
  };
  return {
    ...profile,
    deviceBindings,
    updatedAt: new Date().toISOString(),
  };
}

export function shortSha256(hex: string, head = 8): string {
  if (hex.length <= head * 2 + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-head)}`;
}

export const featureVectorSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  timestampUs: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  faceDetected: z.boolean(),
  blink: z.boolean(),
  eyeYaw: z.number().finite(),
  eyePitch: z.number().finite(),
  headYaw: z.number().finite(),
  headPitch: z.number().finite(),
  headRoll: z.number().finite(),
  faceScale: z.number().positive(),
  analysisLatencyMs: z.number().nonnegative().optional(),
});
export type FeatureVector = z.infer<typeof featureVectorSchema>;

export const calibrationTargetSchema = z.enum([
  "lens",
  "near_lens",
  "left",
  "right",
  "down",
  "above_lens",
  "screen_center",
  "self_preview",
  "head_left_eyes_lens",
  "head_right_eyes_lens",
  "head_down_eyes_lens",
]);
export type CalibrationTarget = z.infer<typeof calibrationTargetSchema>;

const calibrationSampleSchema = z.object({
  target: calibrationTargetSchema,
  feature: featureVectorSchema,
});

export const calibrationSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  trackerId: z.string().min(1),
  trackerVersion: z.string().min(1),
  featureSchemaVersion: z.literal("1.0.0"),
  algorithmVersion: z.string().min(1),
  protocolVersion: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  setupNotes: z.string().max(2000).optional(),
  invalidatedAt: z.string().datetime().optional(),
  invalidationReason: z.string().optional(),
  setupFingerprint: z.object({
    cameraDeviceId: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive(),
    lensAnchorX: z.number(),
    lensAnchorY: z.number(),
  }),
  samples: z.array(calibrationSampleSchema),
  validationSamples: z.array(calibrationSampleSchema).optional(),
  quality: z.object({
    score: z.number().min(0).max(1),
    sampleCount: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    heldOutAccuracy: z.number().min(0).max(1),
    validationSampleCount: z.number().int().nonnegative().optional(),
    heldOutByTarget: z.record(
      z.string(),
      z.object({
        correct: z.number().int().nonnegative(),
        evaluated: z.number().int().nonnegative(),
        accuracy: z.number().min(0).max(1),
      }),
    ).optional(),
    targetQuality: z.record(
      z.string(),
      z.object({
        score: z.number().min(0).max(1),
        usableRatio: z.number().min(0).max(1),
        warnings: z.array(z.string()),
      }),
    ).optional(),
  }),
});
export type Calibration = z.infer<typeof calibrationSchema>;

export const gazePredictionSchema = z.object({
  timestampUs: z.number().int().nonnegative(),
  state: z.enum(gazeStates),
  confidence: z.number().min(0).max(1),
  classProbabilities: z.object({
    contact: z.number().min(0).max(1),
    near_lens: z.number().min(0).max(1),
    off_lens: z.number().min(0).max(1),
    unknown: z.number().min(0).max(1),
  }).optional(),
  rawState: z.enum(gazeStates),
  blinkSuppressed: z.boolean(),
  calibrationId: z.string(),
  trackerId: z.string(),
  trackerVersion: z.string(),
  algorithmVersion: z.string(),
});
export type GazePrediction = z.infer<typeof gazePredictionSchema>;

export const gazeEventSchema = z.object({
  id: z.string(),
  type: z.enum(["break", "recovery", "unknown"]),
  startUs: z.number().int().nonnegative(),
  endUs: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1),
});
export type GazeEvent = z.infer<typeof gazeEventSchema>;

export const sessionManifestSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: z.string(),
  profileId: z.string(),
  calibrationId: z.string(),
  trackerId: z.string(),
  trackerVersion: z.string(),
  algorithmVersion: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  monotonicStartUs: z.number().int().nonnegative(),
  status: z.enum(["recording", "finalizing", "complete", "incomplete", "invalid"]),
  media: z
    .object({
      mimeType: z.string(),
      monotonicStartUs: z.number().int().nonnegative().optional(),
      durationUs: z.number().int().nonnegative(),
      byteLength: z.number().int().nonnegative(),
    })
    .optional(),
  frameCount: z.number().int().nonnegative(),
  droppedFrameCount: z.number().int().nonnegative(),
  recoveryNote: z.string().optional(),
});
export type SessionManifest = z.infer<typeof sessionManifestSchema>;

export const correctionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  startUs: z.number().int().nonnegative(),
  endUs: z.number().int().nonnegative(),
  label: z.enum(["contact", "not_contact", "unknown"]),
  createdAt: z.string().datetime(),
  note: z.string().optional(),
});
export type Correction = z.infer<typeof correctionSchema>;

export interface DeviceInventory {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  cameraPermission: PermissionState | "unsupported";
  microphonePermission: PermissionState | "unsupported";
}
