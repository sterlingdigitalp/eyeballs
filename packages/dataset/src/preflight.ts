import type { ConsentRecord, DatasetIntent } from "../../contracts/src";
import { isConsentActive } from "./consent";

export interface PreflightInput {
  intent: DatasetIntent;
  consents: ConsentRecord[];
  recordingConsentId?: string;
  datasetConsentId?: string;
  faceDetectedRatio: number;
  faceScale: number;
  brightnessOk: boolean;
  audioPeakDbfs: number;
  roomNoiseDbfs: number;
  diskFreeBytes: number;
  estimatedSessionBytes: number;
  outfitLabel?: string;
  backgroundLabel?: string;
}

export interface PreflightResult {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

const MIN_DISK_HEADROOM = 1.25;

export function evaluatePreflight(input: PreflightInput): PreflightResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.intent !== "none") {
    if (!isConsentActive(
      input.consents.find((c) => c.id === input.recordingConsentId),
      "recording",
    )) {
      blockers.push("recording_consent_required");
    }
  }
  if (input.intent === "dataset_candidate") {
    if (!isConsentActive(
      input.consents.find((c) => c.id === input.datasetConsentId),
      "dataset_include",
    )) {
      blockers.push("dataset_consent_required");
    }
    if (!input.outfitLabel) warnings.push("outfit_label_missing");
    if (!input.backgroundLabel) warnings.push("background_label_missing");
  }

  if (input.faceDetectedRatio < 0.9) blockers.push("face_not_stable");
  if (input.faceScale < 0.15 || input.faceScale > 0.65) {
    warnings.push("face_scale_out_of_target");
  }
  if (!input.brightnessOk) warnings.push("lighting_check_failed");
  if (input.audioPeakDbfs > -1) blockers.push("audio_clipping_risk");
  if (input.audioPeakDbfs < -45) warnings.push("audio_too_quiet");
  if (input.roomNoiseDbfs > -35) warnings.push("room_noise_high");
  if (input.diskFreeBytes < input.estimatedSessionBytes * MIN_DISK_HEADROOM) {
    blockers.push("insufficient_storage");
  }

  return { ready: blockers.length === 0, blockers, warnings };
}

export type CriticalMonitorEvent =
  | "disk_low"
  | "device_lost"
  | "audio_clipping"
  | "audio_silence"
  | "face_missing"
  | "focus_loss"
  | "thermal";

/** Only critical in-session warnings — noncritical noise is suppressed. */
export function shouldSurfaceMonitorEvent(
  event: CriticalMonitorEvent,
  consecutiveCount: number,
): boolean {
  if (event === "disk_low" || event === "device_lost") return true;
  if (event === "audio_clipping") return consecutiveCount >= 3;
  if (event === "audio_silence") return consecutiveCount >= 30;
  if (event === "face_missing") return consecutiveCount >= 15;
  if (event === "focus_loss") return consecutiveCount >= 20;
  if (event === "thermal") return consecutiveCount >= 5;
  return false;
}
