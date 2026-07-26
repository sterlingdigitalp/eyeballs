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
  createPhase4GoNoGoDraft,
  evaluationDimensions,
  phase4SourcePackageSchema,
  presenterTwinConditions,
  type BlindEvaluationSchedule,
  type Phase4Candidate,
  type Phase4GoNoGoReport,
  type Phase4SourcePackage,
  type PresenterTwinCondition,
  type PresenterTwinExperiment,
} from "./presenter-twin-experiment";
import { stableStringify, type DatasetVersionManifest } from "./versioning";

export const PHASE4_CANDIDATE_ARCHIVE_FORMAT =
  "presenter-twin-candidate-archive/1.0.0" as const;
export const PHASE4_RATING_SHEET_FORMAT =
  "presenter-twin-rating-sheet/1.0.0" as const;
export const PHASE4_BLIND_REVIEW_FORMAT =
  "presenter-twin-blind-review/1.0.0" as const;

export const phase4CandidateArchiveEntrySchema = z.object({
  candidateId: z.string().min(1),
  condition: z.enum(presenterTwinConditions),
  playbackRelativePath: z
    .string()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.includes("\\") &&
        !value.split("/").some((part) => part === "." || part === ".."),
      "candidate playback path must be a confined relative path",
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  durationSec: z.number().positive().max(600),
  providerId: z.string().min(1).optional(),
  providerVersion: z.string().min(1).optional(),
  seed: z.number().nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export type Phase4CandidateArchiveEntry = z.infer<
  typeof phase4CandidateArchiveEntrySchema
>;

export const phase4CandidateArchiveSchema = z
  .object({
    format: z.literal(PHASE4_CANDIDATE_ARCHIVE_FORMAT),
    experimentId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    entries: z.array(phase4CandidateArchiveEntrySchema).min(1),
    archiveManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  })
  .superRefine((archive, context) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    const hashes = new Set<string>();
    for (const [index, entry] of archive.entries.entries()) {
      if (ids.has(entry.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "candidateId"],
          message: "candidate IDs must be unique",
        });
      }
      if (paths.has(entry.playbackRelativePath)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "playbackRelativePath"],
          message: "candidate playback paths must be unique",
        });
      }
      if (hashes.has(entry.sha256.toLowerCase())) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "sha256"],
          message: "candidate content hashes must be unique",
        });
      }
      ids.add(entry.candidateId);
      paths.add(entry.playbackRelativePath);
      hashes.add(entry.sha256.toLowerCase());
    }
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

/**
 * Verify that an imported candidate archive is content-addressed, belongs to
 * the selected experiment, covers A–D, and cannot silently substitute a
 * different provider for generated Conditions A–C.
 */
export async function verifyCandidateArchive(args: {
  archive: unknown;
  experiment: PresenterTwinExperiment;
}): Promise<Phase4CandidateArchive> {
  const archive = phase4CandidateArchiveSchema.parse(args.archive);
  if (archive.experimentId !== args.experiment.id) {
    throw new Error("Candidate archive experimentId does not match experiment");
  }
  if (!archive.archiveManifestSha256) {
    throw new Error("Candidate archive must include its content SHA-256");
  }
  const resealed = await sealCandidateArchive({
    experimentId: archive.experimentId,
    createdAt: archive.createdAt,
    entries: archive.entries,
  });
  if (resealed.archiveManifestSha256 !== archive.archiveManifestSha256) {
    throw new Error("Candidate archive content SHA-256 does not match");
  }
  for (const condition of presenterTwinConditions) {
    if (!archive.entries.some((entry) => entry.condition === condition)) {
      throw new Error(`Candidate archive is missing condition ${condition}`);
    }
  }
  for (const entry of archive.entries) {
    if (entry.condition === "real_reference") continue;
    if (
      entry.providerId !== args.experiment.provider.providerId ||
      entry.providerVersion !== args.experiment.provider.providerVersion
    ) {
      throw new Error(
        `Candidate ${entry.candidateId} provider lineage does not match experiment`,
      );
    }
  }
  return archive;
}

export function phase4CandidatesFromArchive(
  archive: Phase4CandidateArchive,
): Phase4Candidate[] {
  return phase4CandidateArchiveSchema.parse(archive).entries.map((entry) => ({
    id: entry.candidateId,
    condition: entry.condition,
    playbackAssetId: entry.playbackRelativePath,
    providerId: entry.providerId,
    providerVersion: entry.providerVersion,
  }));
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

export const phase4BlindReviewSessionSchema = z
  .object({
    format: z.literal(PHASE4_BLIND_REVIEW_FORMAT),
    id: z.string().min(1),
    experimentId: z.string().min(1),
    candidateArchiveManifestSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i),
    evaluatorId: z.string().min(1),
    startedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(["in_progress", "complete"]),
    blindIds: z.array(z.string().min(1)).min(4),
    currentIndex: z.number().int().nonnegative(),
    ratings: z.array(phase4RatingSheetEntrySchema),
  })
  .superRefine((session, context) => {
    if (new Set(session.blindIds).size !== session.blindIds.length) {
      context.addIssue({
        code: "custom",
        path: ["blindIds"],
        message: "blind review IDs must be unique",
      });
    }
    if (session.currentIndex > session.blindIds.length) {
      context.addIssue({
        code: "custom",
        path: ["currentIndex"],
        message: "blind review index exceeds schedule",
      });
    }
    if (session.ratings.length !== session.currentIndex) {
      context.addIssue({
        code: "custom",
        path: ["ratings"],
        message: "blind review ratings must match completed index",
      });
    }
    for (const [index, rating] of session.ratings.entries()) {
      if (
        rating.evaluatorId !== session.evaluatorId ||
        rating.blindId !== session.blindIds[index]
      ) {
        context.addIssue({
          code: "custom",
          path: ["ratings", index],
          message: "blind review ratings must follow the hidden schedule",
        });
      }
    }
    const expectedStatus =
      session.currentIndex === session.blindIds.length
        ? "complete"
        : "in_progress";
    if (session.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: `blind review status must be ${expectedStatus}`,
      });
    }
  });
export type Phase4BlindReviewSession = z.infer<
  typeof phase4BlindReviewSessionSchema
>;

export function beginBlindReviewSession(args: {
  experimentId: string;
  candidateArchiveManifestSha256: string;
  evaluatorId: string;
  blindIds: string[];
  startedAt?: string;
}): Phase4BlindReviewSession {
  const startedAt = args.startedAt ?? new Date().toISOString();
  return phase4BlindReviewSessionSchema.parse({
    format: PHASE4_BLIND_REVIEW_FORMAT,
    id: `${args.experimentId}:${args.evaluatorId}:${startedAt}`,
    experimentId: args.experimentId,
    candidateArchiveManifestSha256:
      args.candidateArchiveManifestSha256,
    evaluatorId: args.evaluatorId.trim(),
    startedAt,
    updatedAt: startedAt,
    status: "in_progress",
    blindIds: args.blindIds,
    currentIndex: 0,
    ratings: [],
  });
}

export function recordBlindReviewRating(args: {
  session: Phase4BlindReviewSession;
  scores: Record<string, number>;
  preferenceReason?: string;
  ratedAt?: string;
}): Phase4BlindReviewSession {
  const session = phase4BlindReviewSessionSchema.parse(args.session);
  if (session.status === "complete") {
    throw new Error("Blind review session is already complete");
  }
  const ratedAt = args.ratedAt ?? new Date().toISOString();
  const rating = phase4RatingSheetEntrySchema.parse({
    evaluatorId: session.evaluatorId,
    blindId: session.blindIds[session.currentIndex],
    scores: args.scores,
    preferenceReason: args.preferenceReason?.trim() || undefined,
    ratedAt,
  });
  const currentIndex = session.currentIndex + 1;
  return phase4BlindReviewSessionSchema.parse({
    ...session,
    updatedAt: ratedAt,
    status:
      currentIndex === session.blindIds.length ? "complete" : "in_progress",
    currentIndex,
    ratings: [...session.ratings, rating],
  });
}

export function blindReviewRatingSheet(
  session: Phase4BlindReviewSession,
): Phase4RatingSheet {
  const completed = phase4BlindReviewSessionSchema.parse(session);
  if (completed.status !== "complete") {
    throw new Error("Blind review must be complete before exporting ratings");
  }
  return phase4RatingSheetSchema.parse({
    format: PHASE4_RATING_SHEET_FORMAT,
    experimentId: completed.experimentId,
    createdAt: completed.updatedAt,
    ratings: completed.ratings,
  });
}

export function mergePhase4RatingSheets(
  sheets: Phase4RatingSheet[],
): Phase4RatingSheet {
  if (!sheets.length) {
    throw new Error("At least one rating sheet is required");
  }
  const parsed = sheets.map((sheet) => phase4RatingSheetSchema.parse(sheet));
  const experimentId = parsed[0].experimentId;
  if (parsed.some((sheet) => sheet.experimentId !== experimentId)) {
    throw new Error("Cannot merge ratings from different experiments");
  }
  const ratings = parsed.flatMap((sheet) => sheet.ratings);
  const seen = new Set<string>();
  for (const rating of ratings) {
    const key = `${rating.evaluatorId}:${rating.blindId}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate merged rating ${key}`);
    }
    seen.add(key);
  }
  return phase4RatingSheetSchema.parse({
    format: PHASE4_RATING_SHEET_FORMAT,
    experimentId,
    createdAt: parsed
      .map((sheet) => sheet.createdAt)
      .sort()
      .at(-1)!,
    ratings,
  });
}

export const phase4ArtifactKinds = [
  "mouth_tearing",
  "eye_flicker",
  "gaze_drift",
  "identity_drift",
  "lip_sync_error",
  "temporal_jitter",
  "background_warping",
  "uncanny_moment",
] as const;
export type Phase4ArtifactKind = (typeof phase4ArtifactKinds)[number];

export const phase4ArtifactAnnotationSchema = z
  .object({
    id: z.string().min(1),
    candidateId: z.string().min(1),
    kind: z.enum(phase4ArtifactKinds),
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    severity: z.number().int().min(1).max(5),
    notes: z.string().max(2000).optional(),
  })
  .refine((annotation) => annotation.endSec >= annotation.startSec, {
    message: "artifact annotation end must not precede start",
    path: ["endSec"],
  });
export type Phase4ArtifactAnnotation = z.infer<
  typeof phase4ArtifactAnnotationSchema
>;

export const phase4ExpertCandidateReviewSchema = z.object({
  candidateId: z.string().min(1),
  reviewedAt: z.string().datetime({ offset: true }),
  disposition: z.enum(["acceptable", "minor_edit", "unusable"]),
  annotations: z.array(phase4ArtifactAnnotationSchema),
  notes: z.string().max(4000).optional(),
});
export type Phase4ExpertCandidateReview = z.infer<
  typeof phase4ExpertCandidateReviewSchema
>;

export const PHASE4_EXPERT_REVIEW_FORMAT =
  "presenter-twin-expert-review/1.0.0" as const;
export const phase4ExpertReviewSchema = z
  .object({
    format: z.literal(PHASE4_EXPERT_REVIEW_FORMAT),
    experimentId: z.string().min(1),
    candidateArchiveManifestSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i),
    reviewerId: z.string().min(1),
    startedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
    status: z.enum(["in_progress", "complete"]),
    candidateReviews: z.array(phase4ExpertCandidateReviewSchema),
    reviewManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  })
  .superRefine((review, context) => {
    const ids = new Set<string>();
    for (const [index, candidate] of review.candidateReviews.entries()) {
      if (ids.has(candidate.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["candidateReviews", index, "candidateId"],
          message: "expert candidate reviews must be unique",
        });
      }
      ids.add(candidate.candidateId);
      for (const [annotationIndex, annotation] of candidate.annotations.entries()) {
        if (annotation.candidateId !== candidate.candidateId) {
          context.addIssue({
            code: "custom",
            path: [
              "candidateReviews",
              index,
              "annotations",
              annotationIndex,
              "candidateId",
            ],
            message: "artifact annotation candidate must match its review",
          });
        }
      }
    }
    if (
      review.status === "complete" &&
      (!review.completedAt || !review.reviewManifestSha256)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "completed expert review requires completion time and SHA-256",
      });
    }
  });
export type Phase4ExpertReview = z.infer<typeof phase4ExpertReviewSchema>;

export function beginPhase4ExpertReview(args: {
  experimentId: string;
  candidateArchiveManifestSha256: string;
  reviewerId: string;
  startedAt?: string;
}): Phase4ExpertReview {
  const startedAt = args.startedAt ?? new Date().toISOString();
  return phase4ExpertReviewSchema.parse({
    format: PHASE4_EXPERT_REVIEW_FORMAT,
    experimentId: args.experimentId,
    candidateArchiveManifestSha256:
      args.candidateArchiveManifestSha256,
    reviewerId: args.reviewerId.trim(),
    startedAt,
    updatedAt: startedAt,
    status: "in_progress",
    candidateReviews: [],
  });
}

export function upsertPhase4ExpertCandidateReview(args: {
  review: Phase4ExpertReview;
  candidateReview: Phase4ExpertCandidateReview;
}): Phase4ExpertReview {
  const review = phase4ExpertReviewSchema.parse(args.review);
  if (review.status === "complete") {
    throw new Error("Completed expert review is immutable");
  }
  const candidateReview = phase4ExpertCandidateReviewSchema.parse(
    args.candidateReview,
  );
  return phase4ExpertReviewSchema.parse({
    ...review,
    updatedAt: candidateReview.reviewedAt,
    candidateReviews: [
      ...review.candidateReviews.filter(
        (entry) => entry.candidateId !== candidateReview.candidateId,
      ),
      candidateReview,
    ],
  });
}

function assertExpertReviewCoverage(
  review: Phase4ExpertReview,
  archive: Phase4CandidateArchive,
): void {
  if (
    review.experimentId !== archive.experimentId ||
    review.candidateArchiveManifestSha256 !== archive.archiveManifestSha256
  ) {
    throw new Error("Expert review does not match the candidate archive");
  }
  const byCandidate = new Map(
    review.candidateReviews.map((entry) => [entry.candidateId, entry]),
  );
  for (const candidate of archive.entries) {
    const candidateReview = byCandidate.get(candidate.candidateId);
    if (!candidateReview) {
      throw new Error(
        `Expert review is missing candidate ${candidate.candidateId}`,
      );
    }
    for (const annotation of candidateReview.annotations) {
      if (annotation.endSec > candidate.durationSec) {
        throw new Error(
          `Artifact annotation exceeds ${candidate.candidateId} duration`,
        );
      }
    }
  }
  if (byCandidate.size !== archive.entries.length) {
    throw new Error("Expert review contains candidates outside the archive");
  }
}

function expertReviewHashBody(
  review: Omit<Phase4ExpertReview, "reviewManifestSha256">,
): Uint8Array {
  return new TextEncoder().encode(stableStringify(review));
}

export async function sealPhase4ExpertReview(args: {
  review: Phase4ExpertReview;
  archive: Phase4CandidateArchive;
  completedAt?: string;
}): Promise<Phase4ExpertReview> {
  const review = phase4ExpertReviewSchema.parse(args.review);
  const archive = phase4CandidateArchiveSchema.parse(args.archive);
  assertExpertReviewCoverage(review, archive);
  const completedAt = args.completedAt ?? new Date().toISOString();
  const body = {
    ...review,
    updatedAt: completedAt,
    completedAt,
    status: "complete" as const,
    reviewManifestSha256: undefined,
  };
  delete body.reviewManifestSha256;
  const reviewManifestSha256 = await sha256Hex(expertReviewHashBody(body));
  return phase4ExpertReviewSchema.parse({
    ...body,
    reviewManifestSha256,
  });
}

export async function verifyPhase4ExpertReview(args: {
  review: unknown;
  archive: Phase4CandidateArchive;
}): Promise<Phase4ExpertReview> {
  const review = phase4ExpertReviewSchema.parse(args.review);
  if (
    review.status !== "complete" ||
    !review.reviewManifestSha256 ||
    !review.completedAt
  ) {
    throw new Error("Expert review is not sealed complete");
  }
  const archive = phase4CandidateArchiveSchema.parse(args.archive);
  assertExpertReviewCoverage(review, archive);
  const { reviewManifestSha256, ...body } = review;
  const calculated = await sha256Hex(expertReviewHashBody(body));
  if (calculated !== reviewManifestSha256) {
    throw new Error("Expert review SHA-256 does not match");
  }
  return review;
}

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

/** CSV template with deliberately blank scores; neutral defaults bias results. */
export function blankRatingSheetCsv(args: {
  blindIds: string[];
  evaluatorId?: string;
}): string {
  const header = [
    "evaluatorId",
    "blindId",
    ...evaluationDimensions,
    "preferenceReason",
    "ratedAt",
  ];
  const evaluatorId = args.evaluatorId ?? "evaluator-1";
  const rows = args.blindIds.map((blindId) => [
    evaluatorId,
    blindId,
    ...evaluationDimensions.map(() => ""),
    "",
    "",
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

/** Parse a rating sheet JSON blob (exported template or filled returns). */
export function parseRatingSheet(raw: unknown): Phase4RatingSheet {
  return phase4RatingSheetSchema.parse(raw);
}

/**
 * Reject selective or ambiguous evaluation input. Every evaluator represented
 * in a sheet must rate every scheduled blind entry exactly once.
 */
export function validateRatingSheetForSchedule(args: {
  sheet: Phase4RatingSheet;
  schedule: BlindEvaluationSchedule;
}): Phase4RatingSheet {
  const sheet = phase4RatingSheetSchema.parse(args.sheet);
  if (sheet.experimentId !== args.schedule.experimentId) {
    throw new Error("Rating sheet experiment does not match blind schedule");
  }
  if (!sheet.ratings.length) {
    throw new Error("Rating sheet contains no completed ratings");
  }
  const blindIds = new Set(
    args.schedule.publicEntries.map((entry) => entry.blindId),
  );
  if (blindIds.size !== args.schedule.publicEntries.length) {
    throw new Error("Blind schedule contains duplicate IDs");
  }
  const byEvaluator = new Map<string, Set<string>>();
  for (const rating of sheet.ratings) {
    if (!blindIds.has(rating.blindId)) {
      throw new Error(`Rating references unknown blind ID ${rating.blindId}`);
    }
    const rated = byEvaluator.get(rating.evaluatorId) ?? new Set<string>();
    if (rated.has(rating.blindId)) {
      throw new Error(
        `Evaluator ${rating.evaluatorId} rated ${rating.blindId} more than once`,
      );
    }
    rated.add(rating.blindId);
    byEvaluator.set(rating.evaluatorId, rated);
  }
  for (const [evaluatorId, rated] of byEvaluator) {
    if (rated.size !== blindIds.size) {
      const missing = [...blindIds].filter((blindId) => !rated.has(blindId));
      throw new Error(
        `Evaluator ${evaluatorId} is missing ${missing.join(", ")}`,
      );
    }
  }
  return sheet;
}

/**
 * Parse a simple CSV rating sheet (header must include evaluatorId, blindId,
 * each evaluation dimension).
 */
export function parseRatingSheetCsv(
  csv: string,
  experimentId: string,
  createdAt = new Date().toISOString(),
): Phase4RatingSheet {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("Rating CSV needs a header and at least one data row");
  }
  const header = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const idx = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`Rating CSV missing column ${name}`);
    return index;
  };
  const evaluatorIdx = idx("evaluatorId");
  const blindIdx = idx("blindId");
  const reasonIdx = header.indexOf("preferenceReason");
  const ratedIdx = header.indexOf("ratedAt");
  const dimIdx = Object.fromEntries(
    evaluationDimensions.map((dimension) => [dimension, idx(dimension)]),
  );
  const ratings = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const scores = Object.fromEntries(
      evaluationDimensions.map((dimension) => {
        const value = Number(cells[dimIdx[dimension]]);
        if (!Number.isInteger(value) || value < 1 || value > 5) {
          throw new Error(
            `Invalid score for ${dimension} on blindId ${cells[blindIdx]}`,
          );
        }
        return [dimension, value];
      }),
    );
    return phase4RatingSheetEntrySchema.parse({
      evaluatorId: cells[evaluatorIdx],
      blindId: cells[blindIdx],
      scores,
      preferenceReason:
        reasonIdx >= 0 ? unquote(cells[reasonIdx] ?? "") : undefined,
      ratedAt: ratedIdx >= 0 && cells[ratedIdx] ? cells[ratedIdx] : createdAt,
    });
  });
  return phase4RatingSheetSchema.parse({
    format: PHASE4_RATING_SHEET_FORMAT,
    experimentId,
    createdAt,
    ratings,
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('""', '"');
  }
  return value;
}

export interface EvaluatorConsistencyReport {
  pairsCompared: number;
  meanAbsoluteDelta: number;
  /** Share of repeated pairs with absolute overall_usefulness delta ≤ 1. */
  withinOnePointRate: number;
}

/**
 * Measure consistency on repeated blind IDs (same candidate rated twice).
 * `privateReveal` maps blindId → candidateId (and optional repeatedFromBlindId).
 */
export function measureEvaluatorConsistency(args: {
  ratings: Phase4RatingSheetEntry[];
  privateReveal: Array<{
    blindId: string;
    candidateId: string;
    repeatedFromBlindId?: string;
  }>;
}): EvaluatorConsistencyReport {
  const byBlind = new Map(
    args.ratings.map((rating) => [
      `${rating.evaluatorId}:${rating.blindId}`,
      rating,
    ]),
  );
  const deltas: number[] = [];
  for (const reveal of args.privateReveal) {
    if (!reveal.repeatedFromBlindId) continue;
    for (const rating of args.ratings) {
      if (rating.blindId !== reveal.blindId) continue;
      const original = byBlind.get(
        `${rating.evaluatorId}:${reveal.repeatedFromBlindId}`,
      );
      if (!original) continue;
      const a = rating.scores.overall_usefulness ?? 0;
      const b = original.scores.overall_usefulness ?? 0;
      deltas.push(Math.abs(a - b));
    }
  }
  if (!deltas.length) {
    return { pairsCompared: 0, meanAbsoluteDelta: 0, withinOnePointRate: 0 };
  }
  const meanAbsoluteDelta =
    deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const withinOnePointRate =
    deltas.filter((value) => value <= 1).length / deltas.length;
  return {
    pairsCompared: deltas.length,
    meanAbsoluteDelta,
    withinOnePointRate,
  };
}

/** Expert frame-by-frame artifact inspection checklist (plan §14.7). */
export function expertArtifactChecklist(): Array<{
  id: string;
  title: string;
  detail: string;
}> {
  return [
    {
      id: "mouth",
      title: "Mouth tearing / blur",
      detail: "Inspect lip edges on plosives and wide vowels.",
    },
    {
      id: "eyes",
      title: "Eye flicker / gaze drift",
      detail: "Watch blinks and mid-sentence camera contact.",
    },
    {
      id: "identity",
      title: "Identity drift",
      detail: "Face shape stability across expressions and turns.",
    },
    {
      id: "temporal",
      title: "Frame-to-frame jitter",
      detail: "Stepping, freezing, or warping between adjacent frames.",
    },
    {
      id: "background",
      title: "Background warping",
      detail: "Edges and lighting stability behind the speaker.",
    },
    {
      id: "uncanny",
      title: "Uncanny / unusable moments",
      detail: "Any second that would block social or presentation use.",
    },
  ];
}

/**
 * Propose a go/no-go from blind summary + optional consistency.
 * Human must still set final decision; this only suggests.
 * Auto-go is impossible: `suggested: "go"` requires all three human gates.
 */
export function proposePhase4Decision(args: {
  coachedWinRate: number;
  decidedComparisons: number;
  consistency?: EvaluatorConsistencyReport;
  hasAcceptableCandidate?: boolean;
  providerAcceptable?: boolean;
  expertReviewComplete?: boolean;
}): {
  suggested: "go" | "no_go" | "inconclusive" | "pending";
  rationale: string;
} {
  if (args.decidedComparisons < 1) {
    return {
      suggested: "pending",
      rationale: "No decided coached-vs-baseline comparisons yet.",
    };
  }
  if (args.consistency && args.consistency.pairsCompared > 0) {
    if (args.consistency.withinOnePointRate < 0.5) {
      return {
        suggested: "inconclusive",
        rationale:
          "Evaluator consistency on repeats is low; collect more ratings before deciding.",
      };
    }
  }
  if (args.hasAcceptableCandidate === false) {
    return {
      suggested: "no_go",
      rationale:
        "No candidate marked acceptable for the intended presenter use case.",
    };
  }
  if (args.providerAcceptable === false) {
    return {
      suggested: "no_go",
      rationale: "Provider data-control or rights posture is unacceptable.",
    };
  }
  if (
    args.hasAcceptableCandidate === undefined ||
    args.providerAcceptable === undefined ||
    args.expertReviewComplete !== true
  ) {
    return {
      suggested: "pending",
      rationale:
        "Human candidate acceptability, provider policy, and expert artifact review gates must all be completed.",
    };
  }
  // Plan: clear majority for coached over baseline
  if (args.coachedWinRate >= 0.66 && args.decidedComparisons >= 3) {
    return {
      suggested: "go",
      rationale:
        "Coached condition wins a clear majority of decided comparisons; continue only if at least one candidate is usable.",
    };
  }
  if (args.coachedWinRate <= 0.4 && args.decidedComparisons >= 3) {
    return {
      suggested: "no_go",
      rationale:
        "Coached condition does not beat baseline on matched comparisons.",
    };
  }
  return {
    suggested: "inconclusive",
    rationale:
      "Results are mixed or sample size is small; expand ratings or test a second provider.",
  };
}

/** §14.9: at least one 10–60 second generated candidate for intended use. */
export const ACCEPTABLE_CANDIDATE_DURATION_SEC = {
  min: 10,
  max: 60,
} as const;

export function isAcceptableUseCaseDuration(durationSec: number): boolean {
  return (
    Number.isFinite(durationSec) &&
    durationSec >= ACCEPTABLE_CANDIDATE_DURATION_SEC.min &&
    durationSec <= ACCEPTABLE_CANDIDATE_DURATION_SEC.max
  );
}

/**
 * §14.9 success gate: at least one 10–60s *generated* candidate is acceptable.
 * The real-video reference is a quality ceiling only — never an "acceptable
 * generated candidate" for go.
 */
export function candidatesEligibleForAcceptance(
  archive: Phase4CandidateArchive,
): Phase4CandidateArchiveEntry[] {
  return phase4CandidateArchiveSchema
    .parse(archive)
    .entries.filter(
      (entry) =>
        entry.condition !== "real_reference" &&
        isAcceptableUseCaseDuration(entry.durationSec),
    );
}

export function isGeneratedAcceptableCandidateCondition(
  condition: PresenterTwinCondition | undefined,
): boolean {
  return (
    condition === "uncoached_baseline" ||
    condition === "coached_continuous" ||
    condition === "curated_diverse"
  );
}

export type Phase4CandidateDisposition =
  | "unreviewed"
  | "none_acceptable"
  | "acceptable";
export type Phase4ProviderDisposition =
  | "unreviewed"
  | "acceptable"
  | "unacceptable";

export interface Phase4HumanGateEvidence {
  reviewedAt: string;
  acceptableCandidateId: string | null;
  candidateDisposition: Phase4CandidateDisposition;
  providerDisposition: Phase4ProviderDisposition;
  expertReviewComplete: boolean;
  /** Content hash of the sealed expert review supporting this gate. */
  expertReviewManifestSha256?: string;
  /** Required (with 10–60s range) when candidateDisposition is acceptable. */
  acceptableCandidateDurationSec?: number;
  /** Generated condition only; real_reference is never acceptable for go. */
  acceptableCandidateCondition?: PresenterTwinCondition;
}

/**
 * Resolve UI/human gate inputs into proposePhase4Decision flags + evidence.
 * Selecting an acceptable candidate requires it exists in the archive at 10–60s.
 */
export function resolvePhase4HumanGates(args: {
  /** Candidate id, or sentinel unreviewed/none markers used by the Twin UI. */
  acceptableCandidateSelection: string;
  providerDisposition: string;
  expertReviewComplete: boolean;
  expertReviewManifestSha256?: string;
  expertReview?: Phase4ExpertReview;
  archive?: Phase4CandidateArchive;
  reviewedAt?: string;
}): {
  hasAcceptableCandidate: boolean | undefined;
  providerAcceptable: boolean | undefined;
  expertReviewComplete: boolean;
  evidence: Phase4HumanGateEvidence;
} {
  const reviewedAt = args.reviewedAt ?? new Date().toISOString();
  const selection = args.acceptableCandidateSelection;
  const expertReviewManifestSha256 = args.expertReviewManifestSha256;
  const expertReviewComplete =
    args.expertReviewComplete &&
    /^[a-f0-9]{64}$/i.test(expertReviewManifestSha256 ?? "");
  if (args.expertReview) {
    const review = phase4ExpertReviewSchema.parse(args.expertReview);
    if (
      review.status !== "complete" ||
      review.reviewManifestSha256 !== expertReviewManifestSha256
    ) {
      throw new Error(
        "Human gates require the matching sealed expert review artifact",
      );
    }
    if (
      args.archive &&
      (review.experimentId !== args.archive.experimentId ||
        review.candidateArchiveManifestSha256 !==
          args.archive.archiveManifestSha256)
    ) {
      throw new Error("Expert review does not match the candidate archive");
    }
  }
  let candidateDisposition: Phase4CandidateDisposition;
  let hasAcceptableCandidate: boolean | undefined;
  let acceptableCandidateId: string | null = null;
  let acceptableCandidateDurationSec: number | undefined;

  let acceptableCandidateCondition: PresenterTwinCondition | undefined;

  if (selection === "__unreviewed__" || selection === "") {
    candidateDisposition = "unreviewed";
    hasAcceptableCandidate = undefined;
  } else if (selection === "__none__") {
    candidateDisposition = "none_acceptable";
    hasAcceptableCandidate = false;
  } else {
    const archive = args.archive
      ? phase4CandidateArchiveSchema.parse(args.archive)
      : undefined;
    const entry = archive?.entries.find(
      (candidate) => candidate.candidateId === selection,
    );
    if (!entry) {
      throw new Error(
        `Acceptable candidate ${selection} is not present in the candidate archive`,
      );
    }
    if (entry.condition === "real_reference") {
      throw new Error(
        "Acceptable candidate for go must be a generated condition, not the real-video reference",
      );
    }
    if (!isAcceptableUseCaseDuration(entry.durationSec)) {
      throw new Error(
        `Acceptable candidate must be ${ACCEPTABLE_CANDIDATE_DURATION_SEC.min}–${ACCEPTABLE_CANDIDATE_DURATION_SEC.max}s (got ${entry.durationSec}s)`,
      );
    }
    candidateDisposition = "acceptable";
    hasAcceptableCandidate = true;
    acceptableCandidateId = entry.candidateId;
    acceptableCandidateDurationSec = entry.durationSec;
    acceptableCandidateCondition = entry.condition;
    const expertCandidateReview = args.expertReview?.candidateReviews.find(
      (review) => review.candidateId === entry.candidateId,
    );
    if (expertCandidateReview?.disposition === "unusable") {
      throw new Error(
        "Candidate marked unusable by expert review cannot satisfy the intended-use gate",
      );
    }
  }

  let providerDisposition: Phase4ProviderDisposition;
  let providerAcceptable: boolean | undefined;
  if (
    args.providerDisposition === "acceptable" ||
    args.providerDisposition === "unacceptable"
  ) {
    providerDisposition = args.providerDisposition;
    providerAcceptable = args.providerDisposition === "acceptable";
  } else if (
    args.providerDisposition === "__unreviewed__" ||
    args.providerDisposition === ""
  ) {
    providerDisposition = "unreviewed";
    providerAcceptable = undefined;
  } else {
    throw new Error(
      `Unknown provider disposition ${args.providerDisposition}`,
    );
  }

  return {
    hasAcceptableCandidate,
    providerAcceptable,
    expertReviewComplete,
    evidence: {
      reviewedAt,
      acceptableCandidateId,
      candidateDisposition,
      providerDisposition,
      expertReviewComplete,
      expertReviewManifestSha256,
      acceptableCandidateDurationSec,
      acceptableCandidateCondition,
    },
  };
}

export interface Phase4DecisionRecord extends Phase4GoNoGoReport {
  softwareSuggestion: {
    suggested: "go" | "no_go" | "inconclusive" | "pending";
    rationale: string;
  };
  evaluatorConsistency?: EvaluatorConsistencyReport;
  experimentManifestSha256: string;
  humanGateEvidence: Phase4HumanGateEvidence;
  decidedBy?: string;
  decidedAt?: string;
}

/**
 * Assemble the publishable evaluation record. Decision stays `pending` —
 * software never auto-publishes go. Use finalizePhase4Decision for the human
 * final decision after gates are complete.
 */
export function buildPhase4DecisionRecord(args: {
  experiment: PresenterTwinExperiment;
  coachedVsBaseline: NonNullable<Phase4GoNoGoReport["coachedVsBaseline"]>;
  proposal: {
    suggested: "go" | "no_go" | "inconclusive" | "pending";
    rationale: string;
  };
  humanGateEvidence: Phase4HumanGateEvidence;
  consistency?: EvaluatorConsistencyReport;
  candidateArchiveManifestSha256?: string;
  openRisks?: string[];
  createdAt?: string;
}): Phase4DecisionRecord {
  const openRisks =
    args.openRisks ??
    defaultOpenRisksFromGates({
      evidence: args.humanGateEvidence,
      consistency: args.consistency,
    });
  const draft = createPhase4GoNoGoDraft({
    experiment: args.experiment,
    createdAt: args.createdAt,
    coachedVsBaseline: args.coachedVsBaseline,
    suggestedDecision: args.proposal.suggested,
    decisionRationale: args.proposal.rationale,
    candidateArchiveManifestSha256: args.candidateArchiveManifestSha256,
    openRisks,
    // Explicit: never copy suggestion into decision.
    decision: "pending",
  });
  return {
    ...draft,
    decision: "pending",
    experimentManifestSha256: args.experiment.manifestSha256,
    candidateArchiveManifestSha256: args.candidateArchiveManifestSha256,
    softwareSuggestion: args.proposal,
    evaluatorConsistency: args.consistency,
    humanGateEvidence: args.humanGateEvidence,
  };
}

function defaultOpenRisksFromGates(args: {
  evidence: Phase4HumanGateEvidence;
  consistency?: EvaluatorConsistencyReport;
}): string[] {
  const risks: string[] = [];
  if (!args.consistency || args.consistency.pairsCompared === 0) {
    risks.push("No repeated-candidate consistency pairs in ratings");
  }
  if (args.evidence.candidateDisposition === "unreviewed") {
    risks.push("Candidate usability has not been reviewed");
  } else if (args.evidence.candidateDisposition === "none_acceptable") {
    risks.push("No candidate is acceptable for the intended use case");
  }
  if (args.evidence.providerDisposition === "unreviewed") {
    risks.push("Provider policy has not been accepted or rejected");
  } else if (args.evidence.providerDisposition === "unacceptable") {
    risks.push("Provider data-control or rights posture is unacceptable");
  }
  if (!args.evidence.expertReviewComplete) {
    risks.push("Expert frame-by-frame artifact review is incomplete");
  } else if (
    !/^[a-f0-9]{64}$/i.test(
      args.evidence.expertReviewManifestSha256 ?? "",
    )
  ) {
    risks.push("Expert artifact review is not backed by a sealed SHA-256");
  }
  risks.push("Human must confirm the final published decision");
  return risks;
}

/**
 * Assert complete favorable human gates for publishing go. Shared by finalize
 * so crafted incomplete evidence cannot slip through disposition-only checks.
 */
export function assertCompleteGoHumanGates(
  gates: Phase4HumanGateEvidence,
): void {
  if (gates.candidateDisposition !== "acceptable") {
    throw new Error(
      "Cannot finalize go without an acceptable 10–60s candidate",
    );
  }
  if (!gates.acceptableCandidateId) {
    throw new Error(
      "Cannot finalize go without a recorded acceptable candidate id",
    );
  }
  if (
    gates.acceptableCandidateDurationSec === undefined ||
    !isAcceptableUseCaseDuration(gates.acceptableCandidateDurationSec)
  ) {
    throw new Error(
      "Cannot finalize go without a recorded acceptable candidate duration in the 10–60s window",
    );
  }
  if (
    !isGeneratedAcceptableCandidateCondition(
      gates.acceptableCandidateCondition,
    )
  ) {
    throw new Error(
      "Cannot finalize go without a generated (non-real-reference) acceptable candidate",
    );
  }
  if (gates.providerDisposition !== "acceptable") {
    throw new Error(
      "Cannot finalize go without acceptable provider data-control/rights",
    );
  }
  if (!gates.expertReviewComplete) {
    throw new Error(
      "Cannot finalize go without completed expert artifact review",
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(gates.expertReviewManifestSha256 ?? "")) {
    throw new Error(
      "Cannot finalize go without a sealed expert review SHA-256",
    );
  }
}

/**
 * Human-only finalization. Publishing `go` requires favorable completed gates
 * (acceptable 10–60s *generated* candidate id+duration, provider acceptable,
 * expert review). Software suggestion alone can never force `go`. Incomplete
 * evidence with disposition="acceptable" but missing id/duration is rejected.
 */
export function finalizePhase4Decision(args: {
  record: Phase4DecisionRecord;
  decision: "go" | "no_go" | "inconclusive";
  decisionRationale: string;
  decidedBy: string;
  decidedAt?: string;
}): Phase4DecisionRecord {
  const record = args.record;
  if (record.decision !== "pending") {
    throw new Error("Finalized Phase 4 decision is immutable");
  }
  const decisionRationale = args.decisionRationale.trim();
  if (!decisionRationale) {
    throw new Error("Final decision requires a rationale");
  }
  const decidedBy = args.decidedBy.trim();
  if (!decidedBy) {
    throw new Error("Final decision requires a reviewer identity");
  }
  if (args.decision === "go") {
    assertCompleteGoHumanGates(record.humanGateEvidence);
  }
  return {
    ...record,
    decision: args.decision,
    decisionRationale,
    decidedBy,
    decidedAt: args.decidedAt ?? new Date().toISOString(),
    openRisks:
      args.decision === "go"
        ? record.openRisks.filter(
            (risk) => risk !== "Human must confirm the final published decision",
          )
        : record.openRisks,
  };
}
