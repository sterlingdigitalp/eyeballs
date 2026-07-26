import { invoke } from "@tauri-apps/api/core";
import {
  buildCaptureCoreRecordRequest,
  captureCoreDeviceInventorySchema,
  captureCoreRunResultSchema,
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

/** Tauri invoke: run CaptureCore (prefer dryRun until live TCC parent is ready). */
export async function captureCoreRecord(
  request: CaptureCoreRecordRequest,
): Promise<CaptureCoreRunResult> {
  if (!isTauri()) {
    throw new Error("captureCoreRecord requires the Tauri host");
  }
  const raw = await invoke<unknown>("capture_core_record", { request });
  return captureCoreRunResultSchema.parse(raw);
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

/**
 * Prepare a confined session dir and run dry-run CaptureCore for the profile.
 * Callers should release webview camera/mic first (required for live; harmless for dry-run).
 */
export async function captureCoreDryRun(input: {
  profile: CaptureProfile;
  maxDurationSec?: number;
  sessionId?: string;
}): Promise<CaptureCoreRunResult> {
  const prepared = await captureCorePrepareSession(input.sessionId);
  const request = buildCaptureCoreRecordRequest({
    sessionId: prepared.sessionId,
    sessionRoot: prepared.sessionRoot,
    profile: input.profile,
    dryRun: true,
    maxDurationSec: input.maxDurationSec ?? 1,
  });
  return captureCoreRecord(request);
}

/** List AV devices and merge bindings into a profile copy (caller persists). */
export async function captureCoreReconcileProfile(
  profile: CaptureProfile,
): Promise<CaptureProfile> {
  const inventory = await captureCoreListDevices();
  return reconcileDeviceBindings(profile, inventory);
}

export { buildCaptureCoreRecordRequest, reconcileDeviceBindings };
