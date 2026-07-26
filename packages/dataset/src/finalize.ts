import type {
  AnalysisJob,
  AnalysisJobKind,
  RecordingAsset,
  SessionManifest,
} from "../../contracts/src";
import { isMasterRole } from "./capture";

export type HashFn = (bytes: Uint8Array) => string;

/**
 * Non-cryptographic FNV-1a 64-bit hex digest for pure/unit-test finalization.
 * NOT SHA-256. Production CaptureCore must write real SHA-256 into asset digests.
 * The RecordingAsset field is still named `sha256` for schema stability; treat values
 * from this function as integrity digests only within the prototype substrate.
 */
export function contentDigestHex(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

/** @deprecated Use contentDigestHex — this is not SHA-256. */
export const sha256HexFallback = contentDigestHex;

export function hashAssetBytes(
  bytes: Uint8Array,
  hashFn: HashFn = contentDigestHex,
): string {
  return hashFn(bytes);
}

export async function hashAssetBytesSha256(bytes: Uint8Array): Promise<string> {
  const { sha256Hex } = await import("./sha256");
  return sha256Hex(bytes);
}

export function sealMasterAsset(
  asset: RecordingAsset,
  bytes: Uint8Array,
  durationUs: number,
  hashFn?: HashFn,
): RecordingAsset {
  if (!isMasterRole(asset.role)) {
    throw new Error("sealMasterAsset is only for master roles");
  }
  const sha256 = hashAssetBytes(bytes, hashFn);
  if (bytes.length === 0) {
    return {
      ...asset,
      byteLength: 0,
      durationUs,
      validationState: "incomplete",
      sha256,
    };
  }
  return {
    ...asset,
    byteLength: bytes.length,
    durationUs,
    sha256,
    validationState: "valid",
    immutable: true,
  };
}

/** Seal with real SHA-256 digests (preferred for production integrity). */
export async function sealMasterAssetSha256(
  asset: RecordingAsset,
  bytes: Uint8Array,
  durationUs: number,
): Promise<RecordingAsset> {
  if (!isMasterRole(asset.role)) {
    throw new Error("sealMasterAsset is only for master roles");
  }
  const sha256 = await hashAssetBytesSha256(bytes);
  if (bytes.length === 0) {
    return {
      ...asset,
      byteLength: 0,
      durationUs,
      validationState: "incomplete",
      sha256,
    };
  }
  return {
    ...asset,
    byteLength: bytes.length,
    durationUs,
    sha256,
    validationState: "valid",
    immutable: true,
  };
}

export function validateSealedAsset(asset: RecordingAsset): "complete" | "incomplete" | "invalid" {
  if (asset.validationState === "invalid") return "invalid";
  if (!asset.sha256 || asset.byteLength <= 0) return "incomplete";
  if (asset.validationState !== "valid") return "incomplete";
  return "complete";
}

export function createAnalysisJob(
  sessionId: string,
  kind: AnalysisJobKind,
  nowIso: string,
  inputHashes: string[] = [],
): AnalysisJob {
  return {
    id: `${sessionId}-${kind}`,
    sessionId,
    kind,
    dependsOnJobIds: [],
    status: "pending",
    progress: 0,
    inputHashes,
    outputHashes: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function transitionJob(
  job: AnalysisJob,
  status: AnalysisJob["status"],
  patch: Partial<Pick<AnalysisJob, "progress" | "outputHashes" | "error" | "modelVersion" | "workerId">> = {},
  nowIso: string,
): AnalysisJob {
  return {
    ...job,
    status,
    progress: patch.progress ?? job.progress,
    outputHashes: patch.outputHashes ?? job.outputHashes,
    error: patch.error,
    modelVersion: patch.modelVersion ?? job.modelVersion,
    workerId: patch.workerId ?? job.workerId,
    updatedAt: nowIso,
  };
}

export interface FinalizationInput {
  manifest: SessionManifest;
  masters: RecordingAsset[];
  masterBytes: Record<string, Uint8Array>;
  nowIso: string;
  hashFn?: HashFn;
}

export interface FinalizationResult {
  manifest: SessionManifest;
  assets: RecordingAsset[];
  jobs: AnalysisJob[];
  status: "complete" | "incomplete" | "invalid";
}

/**
 * Stop → validate → hash masters → enqueue derivative jobs.
 * Never rewrites master relativePath or clears immutable.
 * Prefer `useSha256: true` for cryptographic digests.
 */
export async function finalizeSessionRecording(
  input: FinalizationInput & { useSha256?: boolean },
): Promise<FinalizationResult> {
  const sealed = await Promise.all(
    input.masters.map(async (asset) => {
      const bytes = input.masterBytes[asset.id] ?? new Uint8Array();
      if (input.useSha256 !== false && !input.hashFn) {
        return sealMasterAssetSha256(asset, bytes, asset.durationUs ?? 0);
      }
      return sealMasterAsset(asset, bytes, asset.durationUs ?? 0, input.hashFn);
    }),
  );

  const outcomes = sealed.map(validateSealedAsset);
  let status: FinalizationResult["status"] = "complete";
  if (outcomes.includes("invalid")) status = "invalid";
  else if (outcomes.includes("incomplete")) status = "incomplete";

  const inputHashes = sealed
    .map((asset) => asset.sha256)
    .filter((value): value is string => Boolean(value));

  const jobKinds: AnalysisJobKind[] =
    status === "complete"
      ? [
          "validate_media",
          "hash_assets",
          "create_proxy",
          "extract_analysis_audio",
          "transcribe",
          "offline_face",
          "quality",
          "segment",
        ]
      : ["validate_media"];

  const jobs = jobKinds.map((kind) =>
    createAnalysisJob(input.manifest.id, kind, input.nowIso, inputHashes),
  );

  const manifest: SessionManifest = {
    ...input.manifest,
    status,
    endedAt: input.nowIso,
    recoveryNote:
      status === "complete"
        ? input.manifest.recoveryNote
        : `Finalization ${status}: master validation incomplete or invalid`,
  };

  // Derivative placeholders — not masters
  const derivatives: RecordingAsset[] =
    status === "complete"
      ? [
          {
            id: `${input.manifest.id}-proxy`,
            sessionId: input.manifest.id,
            role: "proxy_video",
            relativePath: `sessions/${input.manifest.id}/proxy/review.mp4`,
            mimeType: "video/mp4",
            byteLength: 0,
            validationState: "pending",
            immutable: false,
            createdAt: input.nowIso,
          },
          {
            id: `${input.manifest.id}-analysis-audio`,
            sessionId: input.manifest.id,
            role: "analysis_audio",
            relativePath: `sessions/${input.manifest.id}/proxy/analysis-mono.wav`,
            mimeType: "audio/wav",
            byteLength: 0,
            validationState: "pending",
            immutable: false,
            createdAt: input.nowIso,
          },
        ]
      : [];

  return {
    manifest,
    assets: [...sealed, ...derivatives],
    jobs,
    status,
  };
}
