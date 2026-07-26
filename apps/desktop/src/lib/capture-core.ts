import { invoke } from "@tauri-apps/api/core";
import {
  buildCaptureCoreRecordRequest,
  captureCoreDeviceInventorySchema,
  captureCoreRunResultSchema,
  type CaptureCoreDeviceInventory,
  type CaptureCoreRecordRequest,
  type CaptureCoreRunResult,
  type CaptureCoreSegmentHash,
  type CaptureProfile,
} from "../../../../packages/contracts/src";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

export async function captureCoreScanOrphans(
  sessionsRoot: string,
): Promise<{ orphans: Array<Record<string, unknown>> }> {
  if (!isTauri()) throw new Error("captureCoreScanOrphans requires the Tauri host");
  return invoke("capture_core_scan_orphans", { sessionsRoot });
}

export async function captureCoreListDevices(): Promise<CaptureCoreDeviceInventory> {
  if (!isTauri()) throw new Error("captureCoreListDevices requires the Tauri host");
  const raw = await invoke<unknown>("capture_core_list_devices");
  return captureCoreDeviceInventorySchema.parse(raw);
}

/** Convenience: profile → dry-run record under sessionRoot. */
export async function captureCoreDryRun(input: {
  sessionId: string;
  sessionRoot: string;
  profile: CaptureProfile;
  maxDurationSec?: number;
}): Promise<CaptureCoreRunResult> {
  const request = buildCaptureCoreRecordRequest({
    ...input,
    dryRun: true,
    maxDurationSec: input.maxDurationSec ?? 1,
  });
  return captureCoreRecord(request);
}

export { buildCaptureCoreRecordRequest };
