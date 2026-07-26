import type { ClipCandidate, ConsentRecord, RecordingAsset } from "../../contracts/src";
import { assertCanPromoteToDataset } from "./consent";
import type { SessionManifest } from "../../contracts/src";
import { sha256Hex } from "./sha256";

export interface DatasetVersionManifest {
  id: string;
  version: number;
  createdAt: string;
  immutable: true;
  clipIds: string[];
  clips: Array<{
    clipId: string;
    sessionId: string;
    startUs: number;
    endUs: number;
    label: string;
    sourceAssetIds: string[];
  }>;
  consentIds: string[];
  sourceSessionIds: string[];
  assetHashes: Record<string, string>;
  /** Content hash of this manifest body (excluding this field). */
  manifestSha256: string;
}

export interface ExportPackage {
  format: "presenter_dataset_export/1.0.0";
  datasetId: string;
  version: number;
  manifest: DatasetVersionManifest;
  files: Array<{ relativePath: string; sha256: string; byteLength: number }>;
  packageSha256: string;
}

/**
 * Canonical JSON: recursively sort object keys so nested clip/asset fields
 * always contribute to the hash (root-only key lists strip nested structure).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = canonicalize(record[key]);
  }
  return sorted;
}

export async function hashManifestBody(
  body: Omit<DatasetVersionManifest, "manifestSha256">,
): Promise<string> {
  return sha256Hex(new TextEncoder().encode(stableStringify(body)));
}

function packageBodyForHash(
  pkg: Omit<ExportPackage, "packageSha256">,
): string {
  return stableStringify(pkg);
}

export async function createDatasetVersion(args: {
  datasetId: string;
  version: number;
  createdAt: string;
  sessions: SessionManifest[];
  consents: ConsentRecord[];
  clips: ClipCandidate[];
  assets: RecordingAsset[];
}): Promise<DatasetVersionManifest> {
  const promoted = args.clips.filter(
    (clip) => clip.label === "excellent" || clip.label === "usable",
  );
  if (!promoted.length) {
    throw new Error("No promotable clips (excellent/usable) for dataset version");
  }

  for (const clip of promoted) {
    const session = args.sessions.find((entry) => entry.id === clip.sessionId);
    if (!session) throw new Error(`Missing session ${clip.sessionId}`);
    assertCanPromoteToDataset({ session, consents: args.consents });
  }

  const consentIds = [
    ...new Set(
      promoted.flatMap((clip) => {
        const session = args.sessions.find((entry) => entry.id === clip.sessionId)!;
        return [
          session.dataset?.recordingConsentId,
          session.dataset?.datasetConsentId,
        ].filter(Boolean) as string[];
      }),
    ),
  ].sort();
  const sourceSessionIds = [...new Set(promoted.map((clip) => clip.sessionId))].sort();
  const assetHashes: Record<string, string> = {};
  for (const asset of args.assets) {
    if (sourceSessionIds.includes(asset.sessionId) && asset.sha256) {
      assetHashes[asset.id] = asset.sha256;
    }
  }

  const body: Omit<DatasetVersionManifest, "manifestSha256"> = {
    id: args.datasetId,
    version: args.version,
    createdAt: args.createdAt,
    immutable: true,
    clipIds: promoted.map((clip) => clip.id),
    clips: promoted.map((clip) => ({
      clipId: clip.id,
      sessionId: clip.sessionId,
      startUs: clip.startUs,
      endUs: clip.endUs,
      label: clip.label!,
      sourceAssetIds: args.assets
        .filter((asset) => asset.sessionId === clip.sessionId && asset.role === "master_video")
        .map((asset) => asset.id),
    })),
    consentIds,
    sourceSessionIds,
    assetHashes,
  };

  return {
    ...body,
    manifestSha256: await hashManifestBody(body),
  };
}

/**
 * Revocation creates a new version excluding revoked consent assets.
 * Prior version is returned unchanged (immutability).
 */
export async function createVersionExcludingRevoked(
  prior: DatasetVersionManifest,
  args: {
    createdAt: string;
    revokedConsentIds: string[];
    sessions: SessionManifest[];
    consents: ConsentRecord[];
    clips: ClipCandidate[];
    assets: RecordingAsset[];
  },
): Promise<{ prior: DatasetVersionManifest; next: DatasetVersionManifest }> {
  const priorSnapshot = structuredClone(prior);
  const allowedClips = args.clips.filter((clip) => {
    if (clip.label !== "excellent" && clip.label !== "usable") return false;
    const session = args.sessions.find((entry) => entry.id === clip.sessionId);
    if (!session?.dataset) return false;
    const ids = [
      session.dataset.recordingConsentId,
      session.dataset.datasetConsentId,
    ];
    return !ids.some((id) => id && args.revokedConsentIds.includes(id));
  });

  const next = await createDatasetVersion({
    datasetId: prior.id,
    version: prior.version + 1,
    createdAt: args.createdAt,
    sessions: args.sessions,
    consents: args.consents.filter((consent) => !args.revokedConsentIds.includes(consent.id)),
    clips: allowedClips,
    assets: args.assets,
  });

  // Ensure prior was not mutated
  if (prior.manifestSha256 !== priorSnapshot.manifestSha256) {
    throw new Error("Prior dataset version was mutated");
  }
  return { prior: priorSnapshot, next };
}

export async function buildExportPackage(
  manifest: DatasetVersionManifest,
  fileContents: Record<string, Uint8Array>,
): Promise<ExportPackage> {
  const sorted = Object.entries(fileContents).sort(([a], [b]) => a.localeCompare(b));
  const files = await Promise.all(
    sorted.map(async ([relativePath, bytes]) => ({
      relativePath,
      sha256: await sha256Hex(bytes),
      byteLength: bytes.length,
    })),
  );
  const packageBody: Omit<ExportPackage, "packageSha256"> = {
    format: "presenter_dataset_export/1.0.0",
    datasetId: manifest.id,
    version: manifest.version,
    manifest,
    files,
  };
  const packageSha256 = await sha256Hex(
    new TextEncoder().encode(packageBodyForHash(packageBody)),
  );
  return { ...packageBody, packageSha256 };
}

/**
 * Verify export integrity against the original file bytes.
 * Re-hashes each file with SHA-256, checks manifest self-hash, and recomputes packageSha256.
 */
export async function verifyExportPackage(
  pkg: ExportPackage,
  fileContents: Record<string, Uint8Array>,
): Promise<boolean> {
  if (!pkg.packageSha256 || !pkg.manifest.manifestSha256) return false;

  const expectedManifest = await hashManifestBody({
    id: pkg.manifest.id,
    version: pkg.manifest.version,
    createdAt: pkg.manifest.createdAt,
    immutable: true,
    clipIds: pkg.manifest.clipIds,
    clips: pkg.manifest.clips,
    consentIds: pkg.manifest.consentIds,
    sourceSessionIds: pkg.manifest.sourceSessionIds,
    assetHashes: pkg.manifest.assetHashes,
  });
  if (expectedManifest !== pkg.manifest.manifestSha256) return false;

  if (pkg.files.length !== Object.keys(fileContents).length) return false;

  for (const file of pkg.files) {
    const bytes = fileContents[file.relativePath];
    if (!bytes) return false;
    if (bytes.length !== file.byteLength) return false;
    const digest = await sha256Hex(bytes);
    if (digest !== file.sha256) return false;
  }

  // Detect extra content paths not listed in the package.
  for (const path of Object.keys(fileContents)) {
    if (!pkg.files.some((file) => file.relativePath === path)) return false;
  }

  const body: Omit<ExportPackage, "packageSha256"> = {
    format: pkg.format,
    datasetId: pkg.datasetId,
    version: pkg.version,
    manifest: pkg.manifest,
    files: pkg.files,
  };
  const expectedPackage = await sha256Hex(
    new TextEncoder().encode(packageBodyForHash(body)),
  );
  return expectedPackage === pkg.packageSha256;
}

/** Build a portable JSON archive (manifest + base64 files) for download. */
export async function serializeExportArchive(
  pkg: ExportPackage,
  fileContents: Record<string, Uint8Array>,
): Promise<Uint8Array> {
  const files: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(fileContents)) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    files[path] = btoa(binary);
  }
  const archive = {
    format: "presenter_dataset_archive/1.0.0" as const,
    package: pkg,
    filesBase64: files,
  };
  return new TextEncoder().encode(JSON.stringify(archive, null, 2));
}
