import { z } from "zod";
import type {
  AnalysisJob,
  AnalysisJobKind,
  AvTimingMetadata,
  RecordingAsset,
  SessionManifest,
} from "../../contracts/src";
import { createAnalysisJob } from "./finalize";

export const CAPTURE_SEAL_INGEST_VERSION = "capture-seal-ingest/1.0.0";

const captureFactsSchema = z
  .object({
    negotiatedWidth: z.number().int().positive().optional(),
    negotiatedHeight: z.number().int().positive().optional(),
    negotiatedFrameRate: z.number().positive().optional(),
    requestedWidth: z.number().int().positive().optional(),
    requestedHeight: z.number().int().positive().optional(),
    requestedFrameRate: z.number().positive().optional(),
    measuredVideoFps: z.number().positive().optional(),
    wallDurationSec: z.number().nonnegative().optional(),
    segmentDurationSec: z.number().positive().optional(),
    videoCodec: z.string().min(1).optional(),
    preferPcmAudio: z.boolean().optional(),
    firstVideoPtsUs: z.number().int().nonnegative().optional(),
    firstAudioPtsUs: z.number().int().nonnegative().optional(),
    avInitialOffsetUs: z.number().int().optional(),
    videoFrames: z.number().int().nonnegative().optional(),
    audioBuffers: z.number().int().nonnegative().optional(),
    droppedVideo: z.number().int().nonnegative().optional(),
    finalizedSegments: z.number().int().nonnegative().optional(),
    previewFrames: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const captureCoreSealSchema = z.object({
  protocolVersion: z.string().min(1),
  sessionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  sessionRoot: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith("/") &&
        !value.split("/").some((part) => part === ".." || part === "."),
      "CaptureCore session root must be an absolute normalized path",
    ),
  exitCode: z.number().int(),
  status: z.enum(["complete", "cancelled", "failed"]),
  dryRun: z.boolean(),
  hashedBy: z.string().min(1),
  segmentCount: z.number().int().nonnegative(),
  segments: z.array(
    z.object({
      path: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i),
      byteLength: z.number().int().nonnegative(),
    }),
  ),
  capture: captureFactsSchema.optional().default({}),
  writtenAt: z.string().datetime({ offset: true }),
});

export type CaptureCoreSeal = z.infer<typeof captureCoreSealSchema>;

export interface CaptureSealIngestion {
  version: typeof CAPTURE_SEAL_INGEST_VERSION;
  sessionId: string;
  sessionRoot: string;
  assets: RecordingAsset[];
  avTiming?: AvTimingMetadata;
  jobs: AnalysisJob[];
  capture: CaptureCoreSeal["capture"];
}

function segmentIdentity(
  sessionId: string,
  path: string,
): {
  id: string;
  filename: string;
  role: "master_video" | "master_audio";
  mimeType: string;
} {
  const filename = path.split("/").at(-1) ?? "";
  if (/^seg_\d+_video\.mov$/i.test(filename)) {
    return {
      id: `${sessionId}-${filename.replace(/\.[^.]+$/, "")}`,
      filename,
      role: "master_video",
      mimeType: "video/quicktime",
    };
  }
  if (/^seg_\d+_audio\.caf$/i.test(filename)) {
    return {
      id: `${sessionId}-${filename.replace(/\.[^.]+$/, "")}`,
      filename,
      role: "master_audio",
      mimeType: "audio/x-caf",
    };
  }
  throw new Error(`Unsupported CaptureCore master segment: ${filename || path}`);
}

function assertConfinedSegmentPath(
  seal: CaptureCoreSeal,
  path: string,
): void {
  const expectedPrefix = `${seal.sessionRoot}/master/segments/`;
  if (!path.startsWith(expectedPrefix)) {
    throw new Error(`CaptureCore segment escapes its session root: ${path}`);
  }
  const remainder = path.slice(expectedPrefix.length);
  if (!remainder || remainder.includes("/") || remainder.includes("..")) {
    throw new Error(`CaptureCore segment path is not confined: ${path}`);
  }
}

function buildAvTiming(
  capture: CaptureCoreSeal["capture"],
): AvTimingMetadata | undefined {
  if (
    capture.firstVideoPtsUs === undefined ||
    capture.firstAudioPtsUs === undefined
  ) {
    return undefined;
  }
  return {
    videoMonotonicStartUs: capture.firstVideoPtsUs,
    audioMonotonicStartUs: capture.firstAudioPtsUs,
    initialOffsetUs:
      capture.avInitialOffsetUs ??
      capture.firstAudioPtsUs - capture.firstVideoPtsUs,
    uncorrectable: false,
  };
}

const jobDependencies: Record<AnalysisJobKind, AnalysisJobKind[]> = {
  validate_media: [],
  hash_assets: [],
  create_proxy: ["validate_media", "hash_assets"],
  extract_analysis_audio: ["validate_media", "hash_assets"],
  transcribe: ["extract_analysis_audio"],
  offline_face: ["create_proxy"],
  quality: ["transcribe", "offline_face"],
  segment: ["transcribe", "offline_face", "quality"],
};

export function planAnalysisJobsFromCaptureSeal(
  sessionId: string,
  inputHashes: string[],
  nowIso: string,
): AnalysisJob[] {
  const kinds = Object.keys(jobDependencies) as AnalysisJobKind[];
  return kinds.map((kind) => {
    const base = createAnalysisJob(sessionId, kind, nowIso, inputHashes);
    const job =
      kind === "hash_assets"
        ? {
            ...base,
            status: "succeeded" as const,
            progress: 1,
            workerId: "capture-core/rust-sha2",
            outputHashes: inputHashes,
          }
        : base;
    return {
      ...job,
      dependsOnJobIds: jobDependencies[kind].map(
        (dependency) => `${sessionId}-${dependency}`,
      ),
    };
  });
}

/**
 * Convert a clean CaptureCore seal into immutable master assets and a worker
 * DAG. This trusts no path outside the sealed session root and never re-hashes
 * or rewrites master media in the webview.
 */
export function ingestCaptureCoreSeal(
  raw: unknown,
  options: { allowDryRun?: boolean } = {},
): CaptureSealIngestion {
  const seal = captureCoreSealSchema.parse(raw);
  if (seal.status !== "complete" || seal.exitCode !== 0) {
    throw new Error(
      `CaptureCore session is not complete: ${seal.status}/${seal.exitCode}`,
    );
  }
  if (seal.dryRun && !options.allowDryRun) {
    throw new Error("Dry-run CaptureCore seals cannot become dataset masters");
  }
  if (seal.hashedBy !== "rust-sha2") {
    throw new Error(`Unsupported CaptureCore hash authority: ${seal.hashedBy}`);
  }
  if (seal.segmentCount !== seal.segments.length || seal.segmentCount === 0) {
    throw new Error("CaptureCore seal segment count is inconsistent or empty");
  }

  const seenPaths = new Set<string>();
  const seenHashes = new Set<string>();
  const assets = seal.segments.map((segment) => {
    assertConfinedSegmentPath(seal, segment.path);
    if (seenPaths.has(segment.path)) {
      throw new Error(`Duplicate CaptureCore segment path: ${segment.path}`);
    }
    seenPaths.add(segment.path);
    const identity = segmentIdentity(seal.sessionId, segment.path);
    const digestKey = `${identity.role}:${segment.sha256}`;
    if (seenHashes.has(digestKey)) {
      throw new Error(`Duplicate CaptureCore segment digest: ${segment.sha256}`);
    }
    seenHashes.add(digestKey);
    return {
      id: identity.id,
      sessionId: seal.sessionId,
      role: identity.role,
      relativePath: `sessions/${seal.sessionId}/master/segments/${identity.filename}`,
      mimeType: identity.mimeType,
      byteLength: segment.byteLength,
      sha256: segment.sha256.toLowerCase(),
      validationState: segment.byteLength > 0 ? "valid" as const : "incomplete" as const,
      immutable: true,
      createdAt: seal.writtenAt,
      monotonicStartUs:
        identity.role === "master_video"
          ? seal.capture.firstVideoPtsUs
          : seal.capture.firstAudioPtsUs,
      codec:
        identity.role === "master_video"
          ? seal.capture.videoCodec
          : seal.capture.preferPcmAudio
            ? "linear-pcm"
            : undefined,
    } satisfies RecordingAsset;
  });
  if (!assets.some((asset) => asset.role === "master_video")) {
    throw new Error("CaptureCore seal has no master video segments");
  }
  if (assets.some((asset) => asset.validationState !== "valid")) {
    throw new Error("CaptureCore seal contains an empty master segment");
  }

  const hashes = assets.map((asset) => asset.sha256!);
  return {
    version: CAPTURE_SEAL_INGEST_VERSION,
    sessionId: seal.sessionId,
    sessionRoot: seal.sessionRoot,
    assets,
    avTiming: buildAvTiming(seal.capture),
    jobs: planAnalysisJobsFromCaptureSeal(
      seal.sessionId,
      hashes,
      seal.writtenAt,
    ),
    capture: seal.capture,
  };
}

export function applyCaptureSealToManifest(
  manifest: SessionManifest,
  ingestion: CaptureSealIngestion,
): SessionManifest {
  if (manifest.id !== ingestion.sessionId) {
    throw new Error("CaptureCore seal session does not match the manifest");
  }
  const durationUs =
    ingestion.capture.wallDurationSec !== undefined
      ? Math.round(ingestion.capture.wallDurationSec * 1_000_000)
      : manifest.media?.durationUs;
  const byteLength = ingestion.assets.reduce(
    (sum, asset) => sum + asset.byteLength,
    0,
  );
  return {
    ...manifest,
    status: "complete",
    endedAt: ingestion.assets[0]?.createdAt ?? manifest.endedAt,
    frameCount: ingestion.capture.videoFrames ?? manifest.frameCount,
    droppedFrameCount:
      ingestion.capture.droppedVideo ?? manifest.droppedFrameCount,
    media:
      durationUs !== undefined
        ? {
            mimeType: "application/x-capture-core-segment-set",
            monotonicStartUs: ingestion.avTiming?.videoMonotonicStartUs,
            durationUs,
            byteLength,
          }
        : manifest.media,
    dataset: {
      intent: manifest.dataset?.intent ?? "none",
      ...manifest.dataset,
      avTiming: ingestion.avTiming ?? manifest.dataset?.avTiming,
    },
  };
}
