/**
 * Phase 4 empirical artifacts: candidate archive, evaluator rating sheet,
 * and assembly of sealed condition packages for the controlled A–D proof.
 */
import { z } from "zod";
import type {
  ClipCandidate,
  RecordingAsset,
  SessionManifest,
} from "../../contracts/src";
import { sha256Hex } from "./sha256";
import {
  evaluationDimensions,
  phase4SourcePackageSchema,
  presenterTwinConditions,
  type Phase4SourcePackage,
  type PresenterTwinCondition,
  type PresenterTwinExperiment,
} from "./presenter-twin-experiment";
import { stableStringify, type DatasetVersionManifest } from "./versioning";

export const PHASE4_CANDIDATE_ARCHIVE_FORMAT =
  "presenter-twin-candidate-archive/1.0.0" as const;
export const PHASE4_RATING_SHEET_FORMAT =
  "presenter-twin-rating-sheet/1.0.0" as const;

export const phase4CandidateArchiveEntrySchema = z.object({
  candidateId: z.string().min(1),
  condition: z.enum(presenterTwinConditions),
  playbackRelativePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  providerId: z.string().min(1).optional(),
  providerVersion: z.string().min(1).optional(),
  seed: z.number().nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export type Phase4CandidateArchiveEntry = z.infer<
  typeof phase4CandidateArchiveEntrySchema
>;

export const phase4CandidateArchiveSchema = z.object({
  format: z.literal(PHASE4_CANDIDATE_ARCHIVE_FORMAT),
  experimentId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  entries: z.array(phase4CandidateArchiveEntrySchema).min(1),
  archiveManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});
export type Phase4CandidateArchive = z.infer<typeof phase4CandidateArchiveSchema>;

export async function sealCandidateArchive(
  archive: Omit<Phase4CandidateArchive, "archiveManifestSha256" | "format"> & {
    format?: typeof PHASE4_CANDIDATE_ARCHIVE_FORMAT;
  },
): Promise<Phase4CandidateArchive> {
  const body = {
    format: PHASE4_CANDIDATE_ARCHIVE_FORMAT,
    experimentId: archive.experimentId,
    createdAt: archive.createdAt,
    entries: archive.entries.map((entry) =>
      phase4CandidateArchiveEntrySchema.parse(entry),
    ),
  };
  const archiveManifestSha256 = await sha256Hex(
    new TextEncoder().encode(stableStringify(body)),
  );
  return phase4CandidateArchiveSchema.parse({ ...body, archiveManifestSha256 });
}

const scoreRecordSchema = z.record(
  z.string(),
  z.number().int().min(1).max(5),
);

export const phase4RatingSheetEntrySchema = z.object({
  evaluatorId: z.string().min(1),
  blindId: z.string().min(1),
  scores: scoreRecordSchema.refine(
    (scores) => evaluationDimensions.every((dimension) => dimension in scores),
    { message: "scores must include every evaluation dimension" },
  ),
  preferenceReason: z.string().max(2000).optional(),
  ratedAt: z.string().datetime({ offset: true }).optional(),
});
export type Phase4RatingSheetEntry = z.infer<typeof phase4RatingSheetEntrySchema>;

export const phase4RatingSheetSchema = z.object({
  format: z.literal(PHASE4_RATING_SHEET_FORMAT),
  experimentId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  ratings: z.array(phase4RatingSheetEntrySchema),
});
export type Phase4RatingSheet = z.infer<typeof phase4RatingSheetSchema>;

export function emptyRatingSheet(args: {
  experimentId: string;
  blindIds: string[];
  evaluatorId?: string;
  createdAt?: string;
}): Phase4RatingSheet {
  const createdAt = args.createdAt ?? new Date().toISOString();
  const evaluatorId = args.evaluatorId ?? "evaluator-1";
  const blankScores = Object.fromEntries(
    evaluationDimensions.map((dimension) => [dimension, 3]),
  );
  return phase4RatingSheetSchema.parse({
    format: PHASE4_RATING_SHEET_FORMAT,
    experimentId: args.experimentId,
    createdAt,
    ratings: args.blindIds.map((blindId) => ({
      evaluatorId,
      blindId,
      scores: blankScores,
      preferenceReason: "",
      ratedAt: createdAt,
    })),
  });
}

export function ratingSheetToCsv(sheet: Phase4RatingSheet): string {
  const header = [
    "evaluatorId",
    "blindId",
    ...evaluationDimensions,
    "preferenceReason",
    "ratedAt",
  ];
  const rows = sheet.ratings.map((rating) => [
    rating.evaluatorId,
    rating.blindId,
    ...evaluationDimensions.map((dimension) =>
      String(rating.scores[dimension] ?? ""),
    ),
    JSON.stringify(rating.preferenceReason ?? ""),
    rating.ratedAt ?? "",
  ]);
  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

/** Build one sealed A–D source package when masters/clips already exist. */
export function buildPhase4SourcePackage(args: {
  id: string;
  condition: PresenterTwinCondition;
  createdAt: string;
  session: SessionManifest;
  clips: ClipCandidate[];
  assets: RecordingAsset[];
  script: { id: string; sha256: string };
  voiceAssetId?: string;
  output: Phase4SourcePackage["output"];
  datasetVersion?: DatasetVersionManifest;
}): Phase4SourcePackage {
  const sessionClips = args.clips.filter(
    (clip) => clip.sessionId === args.session.id,
  );
  const assetIds = args.assets
    .filter(
      (asset) =>
        asset.sessionId === args.session.id &&
        asset.validationState === "valid" &&
        Boolean(asset.sha256),
    )
    .map((asset) => asset.id);
  if (assetIds.length === 0) {
    throw new Error(`No valid sealed masters for session ${args.session.id}`);
  }

  const base = {
    id: args.id,
    condition: args.condition,
    createdAt: args.createdAt,
    sourceSessionIds: [args.session.id],
    clipIds: sessionClips.map((clip) => clip.id),
    assetIds,
    script: args.script,
    voiceAssetId: args.voiceAssetId,
    output: args.output,
  };

  switch (args.condition) {
    case "uncoached_baseline":
      return phase4SourcePackageSchema.parse({
        ...base,
        coached: false,
        curated: false,
        continuousTake: false,
        realReference: false,
        clipIds: sessionClips.slice(0, 1).map((clip) => clip.id),
      });
    case "coached_continuous":
      if (!args.session.coaching) {
        throw new Error("Condition B requires a coached session manifest");
      }
      return phase4SourcePackageSchema.parse({
        ...base,
        coached: true,
        curated: false,
        continuousTake: true,
        realReference: false,
        clipIds: [sessionClips[0]?.id].filter(Boolean),
      });
    case "curated_diverse": {
      if (!args.datasetVersion) {
        throw new Error("Condition C requires an immutable dataset version");
      }
      return phase4SourcePackageSchema.parse({
        ...base,
        sourceSessionIds: args.datasetVersion.sourceSessionIds,
        clipIds: args.datasetVersion.clipIds,
        assetIds: args.assets
          .filter(
            (asset) =>
              args.datasetVersion!.sourceSessionIds.includes(asset.sessionId) &&
              asset.validationState === "valid" &&
              Boolean(asset.sha256),
          )
          .map((asset) => asset.id),
        datasetVersionId: args.datasetVersion.id,
        datasetManifestSha256: args.datasetVersion.manifestSha256,
        coached: true,
        curated: true,
        continuousTake: false,
        realReference: false,
      });
    }
    case "real_reference":
      return phase4SourcePackageSchema.parse({
        ...base,
        coached: false,
        curated: false,
        continuousTake: true,
        realReference: true,
        voiceAssetId: undefined,
        clipIds: sessionClips.slice(0, 1).map((clip) => clip.id),
      });
  }
}

export function phase4CaptureChecklist(): Array<{
  id: string;
  title: string;
  detail: string;
}> {
  return [
    {
      id: "script",
      title: "Matched script",
      detail: "One fixed script for A–D; store SHA-256 in Twin proof.",
    },
    {
      id: "voice",
      title: "Shared real voice master",
      detail: "One sealed PCM/audio master used for generated conditions.",
    },
    {
      id: "condition_a",
      title: "Condition A — uncoached baseline",
      detail: "Ordinary usable take; no coaching flags; sealed CaptureCore masters.",
    },
    {
      id: "condition_b",
      title: "Condition B — coached continuous",
      detail: "One coached continuous take; strong lens contact; sealed masters.",
    },
    {
      id: "condition_c",
      title: "Condition C — curated diverse",
      detail: "≥2 excellent/usable clips + immutable dataset version + sealed masters.",
    },
    {
      id: "condition_d",
      title: "Condition D — real reference",
      detail: "Real matched-script recording (not generated); sealed masters.",
    },
    {
      id: "provider",
      title: "Provider requirements",
      detail: "Fill Twin proof JSON; acceptsSeparateVoice must be true.",
    },
    {
      id: "generate",
      title: "Candidates",
      detail: "Run provider offline; import candidate archive when ready.",
    },
    {
      id: "blind",
      title: "Blind evaluation",
      detail: "Export public schedule; collect rating sheet; keep reveal private.",
    },
    {
      id: "decision",
      title: "Go / no-go",
      detail: "Fill go-no-go draft after ratings; do not auto-declare success.",
    },
  ];
}

export function attachCandidateArchiveToExperimentNotes(args: {
  experiment: PresenterTwinExperiment;
  archive: Phase4CandidateArchive;
}): {
  experimentId: string;
  archiveManifestSha256?: string;
  candidateCount: number;
  conditions: PresenterTwinCondition[];
} {
  const archive = phase4CandidateArchiveSchema.parse(args.archive);
  if (archive.experimentId !== args.experiment.id) {
    throw new Error("Candidate archive experimentId does not match experiment");
  }
  return {
    experimentId: args.experiment.id,
    archiveManifestSha256: archive.archiveManifestSha256,
    candidateCount: archive.entries.length,
    conditions: [
      ...new Set(archive.entries.map((entry) => entry.condition)),
    ],
  };
}
