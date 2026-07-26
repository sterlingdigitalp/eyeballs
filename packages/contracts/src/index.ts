import { z } from "zod";

export const gazeStates = ["contact", "near_lens", "off_lens", "unknown"] as const;
export type GazeState = (typeof gazeStates)[number];

export const featureFlagsSchema = z.object({
  experimentalTrackerComparison: z.boolean(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const promptDisplayPlacementSchema = z.object({
  name: z.string().min(1).optional(),
  positionX: z.number().int(),
  positionY: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: z.number().positive(),
});
export type PromptDisplayPlacement = z.infer<
  typeof promptDisplayPlacementSchema
>;

export const captureProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["macbook_practice", "studio_capture", "custom"]),
  cameraDeviceId: z.string(),
  cameraLabel: z.string(),
  microphoneDeviceId: z.string(),
  microphoneLabel: z.string(),
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
  /** Display geometry where lens-adjacent prompt placement was last aligned. */
  promptDisplay: promptDisplayPlacementSchema.optional(),
  updatedAt: z.string().datetime(),
});
export type CaptureProfile = z.infer<typeof captureProfileSchema>;

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

export const curriculumLevels = [
  "lens_comfort",
  "lens_adjacent_reading",
  "prompted_response",
  "presentation_rehearsal",
  "simulated_livestream",
  "live_assist",
] as const;
export type CurriculumLevel = (typeof curriculumLevels)[number];

export const feedbackIntensities = [
  "off",
  "minimal",
  "standard",
  "active",
  "review_only",
] as const;
export type FeedbackIntensity = (typeof feedbackIntensities)[number];

export const promptRevealModes = [
  "one_line",
  "phrase_by_phrase",
  "hide_on_speech",
] as const;
export type PromptRevealMode = (typeof promptRevealModes)[number];

export const cueKinds = [
  "none",
  "halo",
  "pulse",
  "quiet_sound",
  "recovery_ack",
  "recalibration_warning",
] as const;
export type CueKind = (typeof cueKinds)[number];

export const cueRatings = ["helpful", "unnecessary", "wrong"] as const;
export type CueRating = (typeof cueRatings)[number];

export const drillContactPolicySchema = z.object({
  microGlanceToleranceMs: z.number().int().nonnegative(),
  reportableBreakMinMs: z.number().int().positive(),
  longBreakMinMs: z.number().int().positive().optional(),
  contactRecoveryConfirmMs: z.number().int().nonnegative().optional(),
  feedbackCooldownMs: z.number().int().nonnegative(),
  feedbackLevel: z.enum(feedbackIntensities),
  noteAllowedNearLensMs: z.number().int().nonnegative().optional(),
});
export type DrillContactPolicy = z.infer<typeof drillContactPolicySchema>;

export const drillPromptSchema = z.object({
  type: z.enum(["none", "text", "question", "outline", "comment"]),
  text: z.string().default(""),
  phrases: z.array(z.string().min(1)).optional(),
  revealMode: z.enum(promptRevealModes).default("one_line"),
  revealSec: z.number().nonnegative().optional(),
  hideWhenSpeaking: z.boolean().default(false),
});
export type DrillPrompt = z.infer<typeof drillPromptSchema>;

export const drillScoringSchema = z.object({
  excludeFirstSec: z.number().nonnegative().default(0),
  excludeLastSec: z.number().nonnegative().default(0),
  sentenceBoundaryContact: z.boolean().default(false),
  speakingWindowsOnly: z.boolean().default(true),
});
export type DrillScoring = z.infer<typeof drillScoringSchema>;

export const noteAllowedIntervalSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  label: z.string().optional(),
});
export type NoteAllowedInterval = z.infer<typeof noteAllowedIntervalSchema>;

export const drillDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.union([z.number().int().positive(), z.string().min(1)]),
  name: z.string().min(1),
  mode: z.enum(curriculumLevels),
  curriculumLevel: z.number().int().min(1).max(6),
  durationTargetSec: z.number().positive(),
  prompt: drillPromptSchema,
  contactPolicy: drillContactPolicySchema,
  scoring: drillScoringSchema.default({
    excludeFirstSec: 0,
    excludeLastSec: 0,
    sentenceBoundaryContact: false,
    speakingWindowsOnly: true,
  }),
  noteAllowedIntervals: z.array(noteAllowedIntervalSchema).default([]),
  completion: z
    .object({
      minimumSpeakingSec: z.number().nonnegative().optional(),
      minimumDurationSec: z.number().nonnegative().optional(),
    })
    .default({}),
  reflection: z.array(z.string().min(1)).default([]),
  liveAssist: z.boolean().default(false),
  recordingDefault: z.enum(["off", "optional", "on"]).default("optional"),
});
export type DrillDefinition = z.infer<typeof drillDefinitionSchema>;

export const cueEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(cueKinds),
  timestampUs: z.number().int().nonnegative(),
  evidence: z.array(z.string().min(1)).min(1),
  drillId: z.string().min(1).optional(),
  breakDurationMs: z.number().nonnegative().optional(),
  rating: z.enum(cueRatings).optional(),
});
export type CueEvent = z.infer<typeof cueEventSchema>;

export const sessionCoachingSchema = z.object({
  drillId: z.string().min(1),
  drillVersion: z.string().min(1),
  curriculumLevel: z.number().int().min(1).max(6),
  feedbackIntensity: z.enum(feedbackIntensities),
  scoringPolicyVersion: z.string().min(1),
  sessionGoal: z.string().max(500).optional(),
  comfortBefore: z.number().int().min(1).max(5).optional(),
  comfortAfter: z.number().int().min(1).max(5).optional(),
  reflectionNotes: z.array(z.string()).optional(),
  completed: z.boolean().optional(),
  handsFreeAudio: z.boolean().optional(),
  audioGuidanceVersion: z.string().min(1).optional(),
  liveAssist: z.boolean().optional(),
});
export type SessionCoaching = z.infer<typeof sessionCoachingSchema>;

export const consentScopes = [
  "recording",
  "dataset_include",
  "face_analysis",
  "voice_analysis",
] as const;
export type ConsentScope = (typeof consentScopes)[number];

export const datasetIntents = ["none", "coaching_only", "dataset_candidate"] as const;
export type DatasetIntent = (typeof datasetIntents)[number];

export const consentRecordSchema = z.object({
  id: z.string().min(1),
  scopes: z.array(z.enum(consentScopes)).min(1),
  grantedAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  note: z.string().max(2000).optional(),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const recordingAssetRoles = [
  "master_video",
  "master_audio",
  "proxy_video",
  "analysis_audio",
  "waveform",
  "thumbnail",
  "safety_audio",
  "sync_corrected_proxy",
] as const;
export type RecordingAssetRole = (typeof recordingAssetRoles)[number];

export const recordingAssetSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: z.enum(recordingAssetRoles),
  relativePath: z.string().min(1),
  mimeType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().min(1).optional(),
  durationUs: z.number().int().nonnegative().optional(),
  validationState: z.enum(["pending", "valid", "invalid", "incomplete"]),
  immutable: z.boolean().default(true),
  createdAt: z.string().datetime(),
  /** Monotonic capture clock for this stream when known. */
  monotonicStartUs: z.number().int().nonnegative().optional(),
  codec: z.string().optional(),
});
export type RecordingAsset = z.infer<typeof recordingAssetSchema>;

export const avTimingMetadataSchema = z.object({
  videoMonotonicStartUs: z.number().int().nonnegative(),
  audioMonotonicStartUs: z.number().int().nonnegative(),
  initialOffsetUs: z.number().int(),
  measuredDriftUsPerHour: z.number().optional(),
  /** Correction applied only to derivatives; never mutates master identity. */
  derivativeCorrectionUs: z.number().int().optional(),
  syncConfidence: z.number().min(0).max(1).optional(),
  uncorrectable: z.boolean().default(false),
});
export type AvTimingMetadata = z.infer<typeof avTimingMetadataSchema>;

export const jobStatuses = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const analysisJobKinds = [
  "validate_media",
  "hash_assets",
  "create_proxy",
  "extract_analysis_audio",
  "transcribe",
  "offline_face",
  "quality",
  "segment",
] as const;
export type AnalysisJobKind = (typeof analysisJobKinds)[number];

export const analysisJobSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  kind: z.enum(analysisJobKinds),
  status: z.enum(jobStatuses),
  progress: z.number().min(0).max(1).default(0),
  workerId: z.string().optional(),
  modelVersion: z.string().optional(),
  inputHashes: z.array(z.string()).default([]),
  outputHashes: z.array(z.string()).default([]),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AnalysisJob = z.infer<typeof analysisJobSchema>;

export const clipLabels = [
  "excellent",
  "usable",
  "coaching_only",
  "rejected",
  "delete",
] as const;
export type ClipLabel = (typeof clipLabels)[number];

export const clipCandidateSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  startUs: z.number().int().nonnegative(),
  endUs: z.number().int().positive(),
  label: z.enum(clipLabels).optional(),
  reasonTags: z.array(z.string()).default([]),
  proposedBy: z.enum(["auto", "human"]).default("auto"),
  /** Ranges point into master; media is not copied until export. */
  pointsIntoMaster: z.literal(true).default(true),
});
export type ClipCandidate = z.infer<typeof clipCandidateSchema>;

export const speakingWindowSchema = z.object({
  startUs: z.number().int().nonnegative(),
  endUs: z.number().int().nonnegative(),
});
export type SpeakingWindowRecord = z.infer<typeof speakingWindowSchema>;

export const recommendationFeedbackSchema = z.object({
  id: z.string().min(1),
  recommendationId: z.string().min(1),
  drillId: z.string().optional(),
  pinned: z.boolean().optional(),
  dismissed: z.boolean().optional(),
  followed: z.boolean().optional(),
  useful: z.boolean().optional(),
  updatedAt: z.string().datetime(),
});
export type RecommendationFeedback = z.infer<typeof recommendationFeedbackSchema>;

export const sessionDatasetSchema = z.object({
  intent: z.enum(datasetIntents).default("none"),
  recordingConsentId: z.string().optional(),
  datasetConsentId: z.string().optional(),
  faceAnalysisConsentId: z.string().optional(),
  voiceAnalysisConsentId: z.string().optional(),
  outfitLabel: z.string().max(200).optional(),
  backgroundLabel: z.string().max(200).optional(),
  sessionObjective: z.string().max(500).optional(),
  avTiming: avTimingMetadataSchema.optional(),
});
export type SessionDataset = z.infer<typeof sessionDatasetSchema>;

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
  coaching: sessionCoachingSchema.optional(),
  dataset: sessionDatasetSchema.optional(),
  /** Recommendation the user chose to follow for this session, if any. */
  followedRecommendationId: z.string().optional(),
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
