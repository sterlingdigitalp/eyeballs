import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  buildCaptureCoreRecordRequest,
  CAPTURE_CORE_DEFAULT_SEGMENT_SEC,
  CAPTURE_CORE_VERTICAL_SLICE_SEC,
  captureCoreDeviceInventorySchema,
  captureCoreRunResultSchema,
  isCaptureCoreVerticalSliceComplete,
  reconcileDeviceBindings,
  type CaptureCoreDeviceInventory,
  type CaptureCoreRecordRequest,
  type CaptureCoreRunResult,
  type CaptureCoreSegmentHash,
  type CaptureProfile,
} from "../../../../packages/contracts/src";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function isCaptureCoreHostAvailable(): boolean {
  return isTauri();
}

export type CaptureCoreProtocolEvent = {
  type?: string;
  payload?: Record<string, unknown>;
  sessionId?: string;
  sequence?: number;
  [key: string]: unknown;
};

export async function captureCoreSessionsRoot(): Promise<string> {
  if (!isTauri()) throw new Error("captureCoreSessionsRoot requires the Tauri host");
  return invoke<string>("capture_core_sessions_root");
}

export async function captureCorePrepareSession(
  sessionId?: string,
): Promise<{ sessionId: string; sessionRoot: string; sessionsRoot: string }> {
  if (!isTauri()) throw new Error("captureCorePrepareSession requires the Tauri host");
  return invoke("capture_core_prepare_session", { sessionId: sessionId ?? null });
}

/** Tauri invoke: run CaptureCore (prefer dryRun until TCC parent is ready). */
export async function captureCoreRecord(
  request: CaptureCoreRecordRequest,
): Promise<CaptureCoreRunResult> {
  if (!isTauri()) {
    throw new Error("captureCoreRecord requires the Tauri host");
  }
  const raw = await invoke<unknown>("capture_core_record", { request });
  return captureCoreRunResultSchema.parse(raw);
}

/** Cooperative stop of the in-flight record (stdin JSONL). */
export async function captureCoreStop(): Promise<{ sent: boolean; reason?: string }> {
  if (!isTauri()) throw new Error("captureCoreStop requires the Tauri host");
  return invoke("capture_core_stop");
}

export async function captureCoreBinaryPath(): Promise<string> {
  if (!isTauri()) throw new Error("captureCoreBinaryPath requires the Tauri host");
  return invoke<string>("capture_core_binary_path");
}

/** Subscribe to live CaptureCore protocol events while a record runs. */
export async function listenCaptureCoreEvents(
  onEvent: (event: CaptureCoreProtocolEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => undefined;
  }
  return listen<CaptureCoreProtocolEvent>("capture-core-event", (event) => {
    onEvent(event.payload);
  });
}

export async function captureCoreHashFile(path: string): Promise<CaptureCoreSegmentHash> {
  if (!isTauri()) throw new Error("captureCoreHashFile requires the Tauri host");
  return invoke<CaptureCoreSegmentHash>("capture_core_hash_file", { path });
}

export async function captureCoreHashSegments(
  sessionRoot: string,
): Promise<CaptureCoreSegmentHash[]> {
  if (!isTauri()) throw new Error("captureCoreHashSegments requires the Tauri host");
  return invoke<CaptureCoreSegmentHash[]>("capture_core_hash_segments", {
    sessionRoot,
  });
}

export async function captureCoreScanOrphans(sessionsRoot?: string): Promise<{
  sessionsRoot: string;
  orphans: Array<Record<string, unknown>>;
}> {
  if (!isTauri()) throw new Error("captureCoreScanOrphans requires the Tauri host");
  return invoke("capture_core_scan_orphans", {
    sessionsRoot: sessionsRoot ?? null,
  });
}

export async function captureCoreListDevices(): Promise<CaptureCoreDeviceInventory> {
  if (!isTauri()) throw new Error("captureCoreListDevices requires the Tauri host");
  const raw = await invoke<unknown>("capture_core_list_devices");
  return captureCoreDeviceInventorySchema.parse(raw);
}

type PreparedRecord = {
  profile: CaptureProfile;
  maxDurationSec?: number;
  segmentDurationSec?: number;
  sessionId?: string;
  videoOnly?: boolean;
  preferPcmAudio?: boolean;
};

async function prepareAndRecord(
  input: PreparedRecord & { dryRun: boolean },
): Promise<CaptureCoreRunResult> {
  const prepared = await captureCorePrepareSession(input.sessionId);
  const request = buildCaptureCoreRecordRequest({
    sessionId: prepared.sessionId,
    sessionRoot: prepared.sessionRoot,
    profile: input.profile,
    dryRun: input.dryRun,
    maxDurationSec: input.maxDurationSec,
    segmentDurationSec: input.segmentDurationSec ?? CAPTURE_CORE_DEFAULT_SEGMENT_SEC,
    videoOnly: input.videoOnly,
    preferPcmAudio: input.preferPcmAudio,
  });
  return captureCoreRecord(request);
}

/**
 * Prepare a confined session dir and run dry-run CaptureCore for the profile.
 * Callers should release webview camera/mic first (required for live; harmless for dry-run).
 */
export async function captureCoreDryRun(
  input: PreparedRecord,
): Promise<CaptureCoreRunResult> {
  return prepareAndRecord({
    ...input,
    dryRun: true,
    maxDurationSec: input.maxDurationSec ?? 1,
    segmentDurationSec: input.segmentDurationSec ?? 0.4,
  });
}

/**
 * Live CaptureCore record (requires TCC-capable Tauri/Terminal parent + device bindings).
 * Always release webview media before calling.
 */
export async function captureCoreLiveRecord(
  input: PreparedRecord,
): Promise<CaptureCoreRunResult> {
  return prepareAndRecord({
    ...input,
    dryRun: false,
    maxDurationSec: input.maxDurationSec ?? CAPTURE_CORE_VERTICAL_SLICE_SEC,
    segmentDurationSec: input.segmentDurationSec ?? CAPTURE_CORE_DEFAULT_SEGMENT_SEC,
  });
}

/**
 * Charter Stage 4 vertical slice: 30s live when AV camera is bound, else dry-run
 * software path that still produces sealed, hashed segment files.
 */
export async function captureCoreVerticalSlice(input: {
  profile: CaptureProfile;
  preferLive?: boolean;
}): Promise<CaptureCoreRunResult> {
  const preferLive = input.preferLive !== false;
  const hasAvCamera = Boolean(input.profile.deviceBindings?.avFoundationCameraId);
  if (preferLive && hasAvCamera) {
    return captureCoreLiveRecord({
      profile: input.profile,
      maxDurationSec: CAPTURE_CORE_VERTICAL_SLICE_SEC,
      segmentDurationSec: CAPTURE_CORE_DEFAULT_SEGMENT_SEC,
    });
  }
  return captureCoreDryRun({
    profile: input.profile,
    maxDurationSec: 1,
    segmentDurationSec: 0.4,
  });
}

/** List AV devices and merge bindings into a profile copy (caller persists). */
export async function captureCoreReconcileProfile(
  profile: CaptureProfile,
): Promise<CaptureProfile> {
  const inventory = await captureCoreListDevices();
  return reconcileDeviceBindings(profile, inventory);
}

/** Human-readable line from a protocol event for Dataset progress. */
export function summarizeCaptureCoreEvent(event: CaptureCoreProtocolEvent): string {
  const type = typeof event.type === "string" ? event.type : "event";
  const payload = event.payload ?? {};
  if (type === "state" && typeof payload.state === "string") {
    return `State: ${payload.state}`;
  }
  if (type === "health") {
    const frames = payload.videoFrames ?? payload.video_frames ?? "—";
    const seg = payload.segmentIndex ?? payload.segment_index ?? "—";
    return `Recording · segment ${seg} · ${frames} frames`;
  }
  if (type === "segment_finalized") {
    const seg = payload.segmentIndex ?? payload.segment_index ?? "—";
    return `Segment ${seg} finalized`;
  }
  if (type === "recording_finished") {
    return "Recording finished";
  }
  if (type === "error") {
    return "Error from CaptureCore";
  }
  return type;
}

export {
  buildCaptureCoreRecordRequest,
  CAPTURE_CORE_DEFAULT_SEGMENT_SEC,
  CAPTURE_CORE_VERTICAL_SLICE_SEC,
  isCaptureCoreVerticalSliceComplete,
  reconcileDeviceBindings,
};
