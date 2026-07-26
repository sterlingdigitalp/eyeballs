import { z } from "zod";
import type {
  ClipCandidate,
  RecordingAsset,
  SessionManifest,
} from "../../contracts/src";
import { sha256Hex } from "./sha256";
import {
  stableStringify,
  type DatasetVersionManifest,
} from "./versioning";

export const PRESENTER_TWIN_EXPERIMENT_VERSION =
  "presenter-twin-experiment/1.0.0" as const;

export const presenterTwinConditions = [
  "uncoached_baseline",
  "coached_continuous",
  "curated_diverse",
  "real_reference",
] as const;
export type PresenterTwinCondition = (typeof presenterTwinConditions)[number];

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const phase4SourcePackageSchema = z.object({
  id: z.string().min(1),
  condition: z.enum(presenterTwinConditions),
  createdAt: z.string().datetime({ offset: true }),
  sourceSessionIds: z.array(z.string().min(1)).min(1),
  clipIds: z.array(z.string().min(1)),
  assetIds: z.array(z.string().min(1)).min(1),
  datasetVersionId: z.string().min(1).optional(),
  datasetManifestSha256: sha256Schema.optional(),
  coached: z.boolean(),
  curated: z.boolean(),
  continuousTake: z.boolean(),
  realReference: z.boolean(),
  script: z.object({
    id: z.string().min(1),
    sha256: sha256Schema,
  }),
  voiceAssetId: z.string().min(1).optional(),
  output: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    durationSec: z.number().positive().max(600),
  }),
});
export type Phase4SourcePackage = z.infer<typeof phase4SourcePackageSchema>;

export const phase4ProviderRequirementsSchema = z.object({
  providerId: z.string().min(1),
  providerVersion: z.string().min(1),
  reviewedAt: z.string().datetime({ offset: true }),
  localOrCloud: z.enum(["local", "cloud"]),
  acceptedSourceDurationSec: z
    .object({
      min: z.number().nonnegative(),
      max: z.number().positive(),
    })
    .refine((range) => range.max >= range.min, {
      message: "provider duration max must be at least min",
    }),
  acceptedResolution: z.array(z.string().min(1)).min(1),
  acceptedCodecs: z.array(z.string().min(1)).min(1),
  acceptsSegmentedSources: z.boolean(),
  acceptsSeparateVoice: z.boolean(),
  identityVerification: z.string().min(1),
  retentionPolicy: z.string().min(1),
  deletionPolicy: z.string().min(1),
  outputRights: z.string().min(1),
  estimatedCost: z.string().min(1),
  watermarkOrProvenance: z.string().min(1),
  workflow: z.enum(["api", "manual", "local_worker"]),
});
export type Phase4ProviderRequirements = z.infer<
  typeof phase4ProviderRequirementsSchema
>;

export interface PresenterTwinReadinessInput {
  sessions: SessionManifest[];
  clips: ClipCandidate[];
  assets: RecordingAsset[];
  datasetVersions: DatasetVersionManifest[];
  uncoachedSessionId?: string;
  coachedSessionId?: string;
  curatedDatasetVersion?: number;
  realReferenceSessionId?: string;
  scriptSha256?: string;
  voiceAssetId?: string;
  provider?: unknown;
}

export interface PresenterTwinReadiness {
  ready: boolean;
  checks: Array<{
    id:
      | "condition_a"
      | "condition_b"
      | "condition_c"
      | "condition_d"
      | "matched_script"
      | "shared_real_voice"
      | "provider_requirements";
    ready: boolean;
    detail: string;
  }>;
  blockers: string[];
}

function validMasterVideoFor(
  assets: RecordingAsset[],
  sessionId: string | undefined,
): boolean {
  return Boolean(
    sessionId &&
      assets.some(
        (asset) =>
          asset.sessionId === sessionId &&
          asset.role === "master_video" &&
          asset.validationState === "valid" &&
          Boolean(asset.sha256),
      ),
  );
}

export function auditPresenterTwinReadiness(
  input: PresenterTwinReadinessInput,
): PresenterTwinReadiness {
  const uncoached = input.sessions.find(
    (session) => session.id === input.uncoachedSessionId,
  );
  const coached = input.sessions.find(
    (session) => session.id === input.coachedSessionId,
  );
  const realReference = input.sessions.find(
    (session) => session.id === input.realReferenceSessionId,
  );
  const curatedVersion = input.datasetVersions.find(
    (version) => version.version === input.curatedDatasetVersion,
  );
  const conditionA =
    Boolean(uncoached) &&
    uncoached?.status === "complete" &&
    !uncoached.coaching &&
    validMasterVideoFor(input.assets, uncoached.id) &&
    input.clips.some((clip) => clip.sessionId === uncoached.id);
  const conditionB =
    Boolean(coached?.coaching) &&
    coached?.status === "complete" &&
    validMasterVideoFor(input.assets, coached.id) &&
    input.clips.some((clip) => clip.sessionId === coached.id);
  const conditionC =
    Boolean(curatedVersion) &&
    (curatedVersion?.clipIds.length ?? 0) >= 2 &&
    (curatedVersion?.sourceSessionIds.length ?? 0) >= 1 &&
    (curatedVersion?.clipIds ?? []).every((clipId) =>
      input.clips.some(
        (clip) =>
          clip.id === clipId &&
          (clip.label === "excellent" || clip.label === "usable"),
      ),
    ) &&
    (curatedVersion?.sourceSessionIds ?? []).every((sessionId) =>
      validMasterVideoFor(input.assets, sessionId),
    );
  const conditionD =
    Boolean(realReference) &&
    realReference?.status === "complete" &&
    validMasterVideoFor(input.assets, realReference.id) &&
    input.clips.some((clip) => clip.sessionId === realReference.id);
  const matchedScript = sha256Schema.safeParse(input.scriptSha256).success;
  const voiceAsset = input.assets.find(
    (asset) => asset.id === input.voiceAssetId,
  );
  const sharedVoice =
    voiceAsset?.role === "master_audio" &&
    voiceAsset.validationState === "valid" &&
    Boolean(voiceAsset.sha256);
  const providerReady = phase4ProviderRequirementsSchema.safeParse(
    input.provider,
  );
  const checks: PresenterTwinReadiness["checks"] = [
    {
      id: "condition_a",
      ready: conditionA,
      detail: conditionA
        ? "Uncoached complete master selected"
        : "Select a complete uncoached master for Condition A",
    },
    {
      id: "condition_b",
      ready: conditionB,
      detail: conditionB
        ? "Coached continuous master selected"
        : "Select a complete coached master for Condition B",
    },
    {
      id: "condition_c",
      ready: conditionC,
      detail: conditionC
        ? "Curated dataset version has multiple clips and sealed masters"
        : "Create a curated version with at least two clips and sealed masters",
    },
    {
      id: "condition_d",
      ready: conditionD,
      detail: conditionD
        ? "Real-video reference master selected"
        : "Record and select the matched-script real reference",
    },
    {
      id: "matched_script",
      ready: matchedScript,
      detail: matchedScript
        ? "Matched script hash recorded"
        : "Record the SHA-256 of the single matched script",
    },
    {
      id: "shared_real_voice",
      ready: sharedVoice,
      detail: sharedVoice
        ? "One valid real-voice master selected"
        : "Select one sealed real-voice master for generated conditions",
    },
    {
      id: "provider_requirements",
      ready: providerReady.success && providerReady.data.acceptsSeparateVoice,
      detail: providerReady.success && providerReady.data.acceptsSeparateVoice
        ? "Provider requirements are documented"
        : "Document a provider that accepts the shared real-voice input",
    },
  ];
  return {
    ready: checks.every((check) => check.ready),
    checks,
    blockers: checks
      .filter((check) => !check.ready)
      .map((check) => check.detail),
  };
}

export interface Phase4GenerationRequest {
  id: string;
  experimentId: string;
  sourcePackageId: string;
  providerId: string;
  providerVersion: string;
  requestedAt: string;
  candidateCount: number;
  settings: Record<string, string | number | boolean | null>;
  seeds: Array<number | null>;
}

export interface PresenterTwinExperiment {
  format: typeof PRESENTER_TWIN_EXPERIMENT_VERSION;
  id: string;
  createdAt: string;
  sourcePackages: Phase4SourcePackage[];
  provider: Phase4ProviderRequirements;
  generationRequests: Phase4GenerationRequest[];
  manifestSha256: string;
}

function validateCondition(source: Phase4SourcePackage): void {
  switch (source.condition) {
    case "uncoached_baseline":
      if (source.coached || source.curated || source.realReference) {
        throw new Error(
          "Condition A must be uncoached, minimally curated, and not a real-video reference",
        );
      }
      break;
    case "coached_continuous":
      if (
        !source.coached ||
        source.curated ||
        !source.continuousTake ||
        source.realReference ||
        source.clipIds.length !== 1
      ) {
        throw new Error("Condition B must be one coached continuous take");
      }
      break;
    case "curated_diverse":
      if (
        !source.coached ||
        !source.curated ||
        source.continuousTake ||
        source.realReference ||
        source.clipIds.length < 2 ||
        !source.datasetVersionId ||
        !source.datasetManifestSha256
      ) {
        throw new Error(
          "Condition C requires multiple curated clips and an immutable dataset version",
        );
      }
      break;
    case "real_reference":
      if (!source.realReference || source.curated) {
        throw new Error("Condition D must be an ungenerated real-video reference");
      }
      // Generated substitutes cannot masquerade as the real ceiling.
      if (source.voiceAssetId) {
        throw new Error(
          "Condition D is a real recording and must not carry a separate generated-condition voice asset",
        );
      }
      break;
  }
}

function assertControlledInputs(sources: Phase4SourcePackage[]): void {
  const first = sources[0];
  for (const source of sources.slice(1)) {
    if (
      source.script.id !== first.script.id ||
      source.script.sha256 !== first.script.sha256
    ) {
      throw new Error("All Phase 4 conditions must use the same script");
    }
    if (
      source.output.width !== first.output.width ||
      source.output.height !== first.output.height ||
      source.output.fps !== first.output.fps ||
      source.output.durationSec !== first.output.durationSec
    ) {
      throw new Error("All Phase 4 conditions must use equivalent output controls");
    }
  }
  const generated = sources.filter((source) => !source.realReference);
  const voiceAssetIds = new Set(
    generated.map((source) => source.voiceAssetId).filter(Boolean),
  );
  if (voiceAssetIds.size !== 1 || generated.some((source) => !source.voiceAssetId)) {
    throw new Error(
      "Generated Phase 4 conditions must share one real voice asset",
    );
  }
}

export async function createPresenterTwinExperiment(args: {
  id: string;
  createdAt: string;
  sourcePackages: Phase4SourcePackage[];
  provider: Phase4ProviderRequirements;
  candidateCount?: number;
  settings?: Record<string, string | number | boolean | null>;
  seeds?: Array<number | null>;
}): Promise<PresenterTwinExperiment> {
  const provider = phase4ProviderRequirementsSchema.parse(args.provider);
  if (!provider.acceptsSeparateVoice) {
    throw new Error(
      "This Phase 4 proof requires a provider that accepts separate real voice",
    );
  }
  const sources = args.sourcePackages.map((source) =>
    phase4SourcePackageSchema.parse(source),
  );
  const byCondition = new Map(
    sources.map((source) => [source.condition, source]),
  );
  if (
    sources.length !== presenterTwinConditions.length ||
    presenterTwinConditions.some((condition) => !byCondition.has(condition))
  ) {
    throw new Error("Phase 4 requires exactly one source package for conditions A–D");
  }
  sources.forEach(validateCondition);
  assertControlledInputs(sources);

  const candidateCount = args.candidateCount ?? 3;
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > 20) {
    throw new Error("candidateCount must be an integer from 1 to 20");
  }
  const seeds =
    args.seeds ??
    Array.from({ length: candidateCount }, () => null);
  if (seeds.length !== candidateCount) {
    throw new Error("Provide exactly one seed entry per candidate");
  }
  const generationRequests = sources
    .filter((source) => !source.realReference)
    .map((source) => ({
      id: `${args.id}-${source.condition}`,
      experimentId: args.id,
      sourcePackageId: source.id,
      providerId: provider.providerId,
      providerVersion: provider.providerVersion,
      requestedAt: args.createdAt,
      candidateCount,
      settings: args.settings ?? {},
      seeds,
    }));

  const body = {
    format: PRESENTER_TWIN_EXPERIMENT_VERSION,
    id: args.id,
    createdAt: args.createdAt,
    sourcePackages: sources,
    provider,
    generationRequests,
  };
  const manifestSha256 = await sha256Hex(
    new TextEncoder().encode(stableStringify(body)),
  );
  return { ...body, manifestSha256 };
}

export const evaluationDimensions = [
  "facial_likeness",
  "eye_stability",
  "camera_contact",
  "sentence_engagement",
  "lip_sync",
  "articulation",
  "motion_naturalness",
  "temporal_continuity",
  "artifact_burden",
  "overall_usefulness",
] as const;
export type EvaluationDimension = (typeof evaluationDimensions)[number];

export interface Phase4Candidate {
  id: string;
  condition: PresenterTwinCondition;
  playbackAssetId: string;
  providerId?: string;
  providerVersion?: string;
}

export interface BlindEvaluationSchedule {
  format: "presenter-twin-blind-schedule/1.0.0";
  experimentId: string;
  publicEntries: Array<{
    blindId: string;
    playbackAssetId: string;
  }>;
  privateReveal: Array<{
    blindId: string;
    candidateId: string;
    condition: PresenterTwinCondition;
    providerId?: string;
    providerVersion?: string;
    repeatedFromBlindId?: string;
  }>;
}

function seededUnit(seed: string): () => number {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildBlindEvaluationSchedule(args: {
  experimentId: string;
  candidates: Phase4Candidate[];
  seed: string;
  repeatCount?: number;
}): BlindEvaluationSchedule {
  if (args.candidates.length < 4) {
    throw new Error("Blind evaluation requires at least four candidates");
  }
  const ids = new Set(args.candidates.map((candidate) => candidate.id));
  if (ids.size !== args.candidates.length) {
    throw new Error("Blind evaluation candidate IDs must be unique");
  }
  const random = seededUnit(`${args.experimentId}:${args.seed}`);
  const entries = args.candidates.map((candidate) => ({ candidate }));
  const repeatCount = args.repeatCount ?? 1;
  if (
    !Number.isInteger(repeatCount) ||
    repeatCount < 0 ||
    repeatCount > args.candidates.length
  ) {
    throw new Error("repeatCount must fit within the candidate set");
  }
  const repeatCandidates = [...args.candidates];
  for (let index = repeatCandidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [repeatCandidates[index], repeatCandidates[swap]] = [
      repeatCandidates[swap],
      repeatCandidates[index],
    ];
  }
  entries.push(
    ...repeatCandidates.slice(0, repeatCount).map((candidate) => ({ candidate })),
  );
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [entries[index], entries[swap]] = [entries[swap], entries[index]];
  }

  const firstBlindByCandidate = new Map<string, string>();
  const privateReveal = entries.map((entry, index) => {
    const blindId = `candidate-${String(index + 1).padStart(3, "0")}`;
    const repeatedFromBlindId = firstBlindByCandidate.get(entry.candidate.id);
    if (!firstBlindByCandidate.has(entry.candidate.id)) {
      firstBlindByCandidate.set(entry.candidate.id, blindId);
    }
    return {
      blindId,
      candidateId: entry.candidate.id,
      condition: entry.candidate.condition,
      providerId: entry.candidate.providerId,
      providerVersion: entry.candidate.providerVersion,
      repeatedFromBlindId,
    };
  });
  return {
    format: "presenter-twin-blind-schedule/1.0.0",
    experimentId: args.experimentId,
    publicEntries: privateReveal.map((reveal) => ({
      blindId: reveal.blindId,
      playbackAssetId: args.candidates.find(
        (candidate) => candidate.id === reveal.candidateId,
      )!.playbackAssetId,
    })),
    privateReveal,
  };
}

export interface BlindCandidateRating {
  evaluatorId: string;
  blindId: string;
  scores: Record<EvaluationDimension, number>;
  preferenceReason?: string;
}

export function validateBlindCandidateRating(
  rating: BlindCandidateRating,
): BlindCandidateRating {
  for (const dimension of evaluationDimensions) {
    const score = rating.scores[dimension];
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error(`${dimension} must be rated from 1 to 5`);
    }
  }
  return rating;
}

/**
 * Publishable Phase 4 go/no-go skeleton. Fill empirical fields after blind review.
 * Does not claim a result until `decision` is set by humans.
 */
export interface Phase4GoNoGoReport {
  format: "presenter-twin-go-no-go/1.0.0";
  experimentId: string;
  createdAt: string;
  thesis: string;
  conditions: PresenterTwinCondition[];
  providerId?: string;
  providerVersion?: string;
  blindScheduleSeed?: string;
  experimentManifestSha256?: string;
  candidateArchiveManifestSha256?: string;
  coachedVsBaseline?: {
    coachedWins: number;
    baselineWins: number;
    ties: number;
    coachedWinRate: number;
  };
  /** Software may only suggest; final decision is human-set. */
  decision: "pending" | "go" | "no_go" | "inconclusive";
  decisionRationale: string;
  openRisks: string[];
}

export function createPhase4GoNoGoDraft(args: {
  experiment: PresenterTwinExperiment;
  createdAt?: string;
  coachedVsBaseline?: {
    coachedWins: number;
    baselineWins: number;
    ties: number;
    coachedWinRate: number;
  };
  openRisks?: string[];
  /** Suggested by software; final published decision remains human-set. */
  suggestedDecision?: Phase4GoNoGoReport["decision"];
  decisionRationale?: string;
  /**
   * Non-go outcomes only. Publishing `go` is impossible from this draft
   * constructor — even if `decision: "go"` is passed, the artifact stays
   * `pending`. Use finalizePhase4Decision with complete human gates for go.
   */
  decision?: Phase4GoNoGoReport["decision"];
  candidateArchiveManifestSha256?: string;
}): Phase4GoNoGoReport {
  const requested = args.decision ?? "pending";
  // Criterion 4: auto-go without gates is impossible. Drafts cannot publish go.
  const decision: Phase4GoNoGoReport["decision"] =
    requested === "go" ? "pending" : requested;
  const openRisks = [
    ...(args.openRisks ?? [
      "No generation candidates produced yet",
      "Blind ratings empty",
      "Provider not selected or not run",
    ]),
  ];
  if (requested === "go" && !openRisks.includes(
    "Go requires finalizePhase4Decision with complete human gates",
  )) {
    openRisks.push(
      "Go requires finalizePhase4Decision with complete human gates",
    );
  }
  return {
    format: "presenter-twin-go-no-go/1.0.0",
    experimentId: args.experiment.id,
    createdAt: args.createdAt ?? new Date().toISOString(),
    thesis:
      "Intentionally coached, curated footage produces a more convincing presenter twin than ordinary uncoached source footage.",
    conditions: [...presenterTwinConditions],
    providerId: args.experiment.provider.providerId || undefined,
    providerVersion: args.experiment.provider.providerVersion || undefined,
    experimentManifestSha256: args.experiment.manifestSha256,
    candidateArchiveManifestSha256: args.candidateArchiveManifestSha256,
    coachedVsBaseline: args.coachedVsBaseline,
    decision,
    decisionRationale:
      requested === "go"
        ? args.decisionRationale ??
          "Go cannot be published from createPhase4GoNoGoDraft; use finalizePhase4Decision with complete human gates."
        : args.decisionRationale ??
          (args.suggestedDecision
            ? `Software suggestion: ${args.suggestedDecision}. Human confirmation required.`
            : "Empirical blind evaluation and human review not yet complete."),
    openRisks,
  };
}

/** Public blind schedule (no condition/provider reveal) for evaluators. */
export function publicBlindScheduleArtifact(
  schedule: BlindEvaluationSchedule,
): {
  format: BlindEvaluationSchedule["format"];
  experimentId: string;
  entries: BlindEvaluationSchedule["publicEntries"];
} {
  return {
    format: schedule.format,
    experimentId: schedule.experimentId,
    entries: schedule.publicEntries,
  };
}

export function summarizeCoachedVsBaseline(args: {
  schedule: BlindEvaluationSchedule;
  ratings: BlindCandidateRating[];
}): {
  coachedWins: number;
  baselineWins: number;
  ties: number;
  coachedWinRate: number;
} {
  const reveal = new Map(
    args.schedule.privateReveal.map((entry) => [entry.blindId, entry]),
  );
  const byEvaluator = new Map<
    string,
    { baseline: number[]; coached: number[] }
  >();
  for (const rating of args.ratings.map(validateBlindCandidateRating)) {
    const condition = reveal.get(rating.blindId)?.condition;
    if (
      condition !== "uncoached_baseline" &&
      condition !== "coached_continuous" &&
      condition !== "curated_diverse"
    ) {
      continue;
    }
    const value =
      (rating.scores.camera_contact + rating.scores.overall_usefulness) / 2;
    const values = byEvaluator.get(rating.evaluatorId) ?? {
      baseline: [],
      coached: [],
    };
    if (condition === "uncoached_baseline") values.baseline.push(value);
    else values.coached.push(value);
    byEvaluator.set(rating.evaluatorId, values);
  }
  let coachedWins = 0;
  let baselineWins = 0;
  let ties = 0;
  for (const values of byEvaluator.values()) {
    if (!values.baseline.length || !values.coached.length) continue;
    const baseline =
      values.baseline.reduce((sum, value) => sum + value, 0) /
      values.baseline.length;
    const coached =
      values.coached.reduce((sum, value) => sum + value, 0) /
      values.coached.length;
    if (coached > baseline) coachedWins += 1;
    else if (baseline > coached) baselineWins += 1;
    else ties += 1;
  }
  const decided = coachedWins + baselineWins;
  return {
    coachedWins,
    baselineWins,
    ties,
    coachedWinRate: decided ? coachedWins / decided : 0,
  };
}
