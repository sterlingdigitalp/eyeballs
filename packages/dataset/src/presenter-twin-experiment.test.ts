import { describe, expect, it } from "vitest";
import {
  auditPresenterTwinReadiness,
  buildBlindEvaluationSchedule,
  createPhase4GoNoGoDraft,
  createPresenterTwinExperiment,
  evaluationDimensions,
  publicBlindScheduleArtifact,
  summarizeCoachedVsBaseline,
  type BlindCandidateRating,
  type Phase4ProviderRequirements,
  type Phase4SourcePackage,
} from "./presenter-twin-experiment";
import type {
  ClipCandidate,
  RecordingAsset,
  SessionManifest,
} from "../../contracts/src";
import type { DatasetVersionManifest } from "./versioning";

const digest = (character: string) => character.repeat(64);
const createdAt = "2026-07-26T12:00:00.000Z";
const common = {
  createdAt,
  sourceSessionIds: ["session"],
  assetIds: ["asset"],
  script: { id: "matched-script", sha256: digest("a") },
  voiceAssetId: "real-voice-asset",
  output: { width: 1920, height: 1080, fps: 30, durationSec: 30 },
};

const sources = (): Phase4SourcePackage[] => [
  {
    ...common,
    id: "source-a",
    condition: "uncoached_baseline",
    clipIds: ["clip-a"],
    coached: false,
    curated: false,
    continuousTake: true,
    realReference: false,
  },
  {
    ...common,
    id: "source-b",
    condition: "coached_continuous",
    clipIds: ["clip-b"],
    coached: true,
    curated: false,
    continuousTake: true,
    realReference: false,
  },
  {
    ...common,
    id: "source-c",
    condition: "curated_diverse",
    sourceSessionIds: ["session-1", "session-2"],
    clipIds: ["clip-c1", "clip-c2"],
    assetIds: ["asset-c1", "asset-c2"],
    datasetVersionId: "dataset-v1",
    datasetManifestSha256: digest("b"),
    coached: true,
    curated: true,
    continuousTake: false,
    realReference: false,
  },
  {
    ...common,
    id: "source-d",
    condition: "real_reference",
    clipIds: ["clip-d"],
    coached: true,
    curated: false,
    continuousTake: true,
    realReference: true,
    voiceAssetId: undefined,
  },
];

const provider: Phase4ProviderRequirements = {
  providerId: "provider",
  providerVersion: "2026-07-26",
  reviewedAt: createdAt,
  localOrCloud: "local",
  acceptedSourceDurationSec: { min: 10, max: 120 },
  acceptedResolution: ["1920x1080"],
  acceptedCodecs: ["h264"],
  acceptsSegmentedSources: true,
  acceptsSeparateVoice: true,
  identityVerification: "local user confirmation",
  retentionPolicy: "local only",
  deletionPolicy: "delete project artifacts",
  outputRights: "user controlled",
  estimatedCost: "$0",
  watermarkOrProvenance: "manifest provenance",
  workflow: "local_worker",
};

const scores = (camera: number, usefulness: number) =>
  Object.fromEntries(
    evaluationDimensions.map((dimension) => [
      dimension,
      dimension === "camera_contact"
        ? camera
        : dimension === "overall_usefulness"
          ? usefulness
          : 4,
    ]),
  ) as BlindCandidateRating["scores"];

describe("Phase 4 presenter-twin experiment", () => {
  it("creates controlled A-D packages and generation requests only for A-C", async () => {
    const experiment = await createPresenterTwinExperiment({
      id: "experiment-1",
      createdAt,
      sourcePackages: sources(),
      provider,
      candidateCount: 2,
      seeds: [11, 12],
      settings: { motionStrength: 1 },
    });
    expect(experiment.format).toBe("presenter-twin-experiment/1.0.0");
    expect(experiment.sourcePackages).toHaveLength(4);
    expect(experiment.generationRequests).toHaveLength(3);
    expect(
      experiment.generationRequests.some(
        (request) => request.sourcePackageId === "source-d",
      ),
    ).toBe(false);
    expect(experiment.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects missing conditions, mismatched scripts, and weak Condition C lineage", async () => {
    await expect(
      createPresenterTwinExperiment({
        id: "missing",
        createdAt,
        sourcePackages: sources().slice(0, 3),
        provider,
      }),
    ).rejects.toThrow(/exactly one/);
    const mismatched = sources();
    mismatched[1] = {
      ...mismatched[1],
      script: { id: "other", sha256: digest("c") },
    };
    await expect(
      createPresenterTwinExperiment({
        id: "script",
        createdAt,
        sourcePackages: mismatched,
        provider,
      }),
    ).rejects.toThrow(/same script/);
    const weakCurated = sources();
    weakCurated[2] = {
      ...weakCurated[2],
      clipIds: ["only-one"],
    };
    await expect(
      createPresenterTwinExperiment({
        id: "weak",
        createdAt,
        sourcePackages: weakCurated,
        provider,
      }),
    ).rejects.toThrow(/multiple curated clips/);
    await expect(
      createPresenterTwinExperiment({
        id: "no-real-voice",
        createdAt,
        sourcePackages: sources(),
        provider: { ...provider, acceptsSeparateVoice: false },
      }),
    ).rejects.toThrow(/separate real voice/);
  });

  it("rejects coached baseline, multi-clip continuous, unversioned curated, and generated real reference", async () => {
    const coachedBaseline = sources();
    coachedBaseline[0] = { ...coachedBaseline[0], coached: true };
    await expect(
      createPresenterTwinExperiment({
        id: "coached-a",
        createdAt,
        sourcePackages: coachedBaseline,
        provider,
      }),
    ).rejects.toThrow(/Condition A/);

    const multiClipContinuous = sources();
    multiClipContinuous[1] = {
      ...multiClipContinuous[1],
      clipIds: ["clip-b1", "clip-b2"],
    };
    await expect(
      createPresenterTwinExperiment({
        id: "multi-b",
        createdAt,
        sourcePackages: multiClipContinuous,
        provider,
      }),
    ).rejects.toThrow(/Condition B/);

    const unversionedCurated = sources();
    unversionedCurated[2] = {
      ...unversionedCurated[2],
      datasetVersionId: undefined,
      datasetManifestSha256: undefined,
    };
    await expect(
      createPresenterTwinExperiment({
        id: "unversioned-c",
        createdAt,
        sourcePackages: unversionedCurated,
        provider,
      }),
    ).rejects.toThrow(/Condition C|immutable dataset version/);

    const generatedAsReal = sources();
    generatedAsReal[3] = {
      ...generatedAsReal[3],
      voiceAssetId: "real-voice-asset",
    };
    await expect(
      createPresenterTwinExperiment({
        id: "generated-d",
        createdAt,
        sourcePackages: generatedAsReal,
        provider,
      }),
    ).rejects.toThrow(/Condition D|real recording/);
  });

  it("builds a deterministic blind schedule without public condition/provider labels", () => {
    const candidates = sources().map((source) => ({
      id: `candidate-${source.condition}`,
      condition: source.condition,
      playbackAssetId: `playback-${source.condition}`,
      providerId: source.realReference ? undefined : "provider",
      providerVersion: source.realReference ? undefined : "1",
    }));
    const first = buildBlindEvaluationSchedule({
      experimentId: "experiment-1",
      candidates,
      seed: "blind-seed",
      repeatCount: 1,
    });
    const second = buildBlindEvaluationSchedule({
      experimentId: "experiment-1",
      candidates,
      seed: "blind-seed",
      repeatCount: 1,
    });
    expect(first).toEqual(second);
    expect(first.publicEntries).toHaveLength(5);
    expect(
      first.publicEntries.some((entry) => "condition" in entry),
    ).toBe(false);
    expect(
      first.privateReveal.filter((entry) => entry.repeatedFromBlindId).length,
    ).toBe(1);
  });

  it("summarizes coached wins only after joining the private reveal map", () => {
    const candidates = sources().map((source) => ({
      id: `candidate-${source.condition}`,
      condition: source.condition,
      playbackAssetId: `playback-${source.condition}`,
    }));
    const schedule = buildBlindEvaluationSchedule({
      experimentId: "experiment-score",
      candidates,
      seed: "score-seed",
      repeatCount: 0,
    });
    const blindByCondition = new Map(
      schedule.privateReveal.map((entry) => [entry.condition, entry.blindId]),
    );
    const ratings: BlindCandidateRating[] = [
      {
        evaluatorId: "evaluator-1",
        blindId: blindByCondition.get("uncoached_baseline")!,
        scores: scores(2, 2),
      },
      {
        evaluatorId: "evaluator-1",
        blindId: blindByCondition.get("coached_continuous")!,
        scores: scores(5, 4),
      },
      {
        evaluatorId: "evaluator-2",
        blindId: blindByCondition.get("uncoached_baseline")!,
        scores: scores(4, 4),
      },
      {
        evaluatorId: "evaluator-2",
        blindId: blindByCondition.get("curated_diverse")!,
        scores: scores(3, 3),
      },
    ];
    expect(summarizeCoachedVsBaseline({ schedule, ratings })).toEqual({
      coachedWins: 1,
      baselineWins: 1,
      ties: 0,
      coachedWinRate: 0.5,
    });
  });

  it("builds a pending go/no-go draft and public blind artifact", async () => {
    const experiment = await createPresenterTwinExperiment({
      id: "exp-go",
      createdAt,
      sourcePackages: sources(),
      provider,
    });
    const draft = createPhase4GoNoGoDraft({
      experiment,
      suggestedDecision: "go",
    });
    expect(draft.format).toBe("presenter-twin-go-no-go/1.0.0");
    expect(draft.decision).toBe("pending");
    expect(draft.experimentManifestSha256).toBe(experiment.manifestSha256);
    expect(draft.decisionRationale).toMatch(/Human confirmation required/);
    expect(draft.experimentId).toBe("exp-go");
    expect(draft.openRisks.length).toBeGreaterThan(0);
    // Even an explicit decision: "go" is clamped to pending (no auto-go).
    const forced = createPhase4GoNoGoDraft({
      experiment,
      decision: "go",
    });
    expect(forced.decision).toBe("pending");

    const schedule = buildBlindEvaluationSchedule({
      experimentId: experiment.id,
      seed: "public-seed",
      candidates: [
        {
          id: "c-a",
          condition: "uncoached_baseline",
          playbackAssetId: "p-a",
        },
        {
          id: "c-b",
          condition: "coached_continuous",
          playbackAssetId: "p-b",
        },
        {
          id: "c-c",
          condition: "curated_diverse",
          playbackAssetId: "p-c",
        },
        {
          id: "c-d",
          condition: "real_reference",
          playbackAssetId: "p-d",
        },
      ],
    });
    const publicArtifact = publicBlindScheduleArtifact(schedule);
    expect(publicArtifact.entries).toHaveLength(schedule.publicEntries.length);
    expect(publicArtifact).not.toHaveProperty("privateReveal");
    expect(
      JSON.stringify(publicArtifact).includes("uncoached_baseline"),
    ).toBe(false);
  });

  it("reports concrete Phase 4 blockers until all controlled sources exist", () => {
    const session = (
      id: string,
      coached: boolean,
    ): SessionManifest => ({
      schemaVersion: "1.0.0",
      id,
      profileId: "profile",
      calibrationId: "calibration",
      trackerId: "tracker",
      trackerVersion: "1",
      algorithmVersion: "algorithm",
      startedAt: createdAt,
      monotonicStartUs: 0,
      status: "complete",
      frameCount: 100,
      droppedFrameCount: 0,
      coaching: coached
        ? {
            drillId: "drill",
            drillVersion: "1",
            curriculumLevel: 4,
            feedbackIntensity: "standard",
            scoringPolicyVersion: "1",
          }
        : undefined,
    });
    const sessions = [
      session("baseline", false),
      session("coached", true),
      session("reference", true),
    ];
    const clips: ClipCandidate[] = [
      "baseline",
      "coached",
      "reference",
    ].map((sessionId) => ({
      id: `clip-${sessionId}`,
      sessionId,
      startUs: 0,
      endUs: 10_000_000,
      label: "excellent",
      reasonTags: [],
      proposedBy: "human",
      pointsIntoMaster: true,
    }));
    clips.push(
      {
        ...clips[1],
        id: "curated-1",
      },
      {
        ...clips[1],
        id: "curated-2",
      },
    );
    const assets: RecordingAsset[] = sessions.flatMap((entry) => [
      {
        id: `video-${entry.id}`,
        sessionId: entry.id,
        role: "master_video",
        relativePath: `sessions/${entry.id}/master.mov`,
        mimeType: "video/quicktime",
        byteLength: 100,
        sha256: digest("d"),
        validationState: "valid",
        immutable: true,
        createdAt,
      },
      {
        id: `audio-${entry.id}`,
        sessionId: entry.id,
        role: "master_audio",
        relativePath: `sessions/${entry.id}/master.caf`,
        mimeType: "audio/x-caf",
        byteLength: 100,
        sha256: digest("e"),
        validationState: "valid",
        immutable: true,
        createdAt,
      },
    ]);
    const version: DatasetVersionManifest = {
      id: "dataset",
      version: 1,
      createdAt,
      immutable: true,
      clipIds: ["curated-1", "curated-2"],
      clips: [],
      consentIds: [],
      sourceSessionIds: ["coached"],
      assetHashes: {},
      manifestSha256: digest("f"),
    };

    const incomplete = auditPresenterTwinReadiness({
      sessions,
      clips,
      assets,
      datasetVersions: [version],
    });
    expect(incomplete.ready).toBe(false);
    expect(incomplete.blockers).toContain(
      "Select a complete uncoached master for Condition A",
    );

    const ready = auditPresenterTwinReadiness({
      sessions,
      clips,
      assets,
      datasetVersions: [version],
      uncoachedSessionId: "baseline",
      coachedSessionId: "coached",
      curatedDatasetVersion: 1,
      realReferenceSessionId: "reference",
      scriptSha256: digest("a"),
      voiceAssetId: "audio-coached",
      provider,
    });
    expect(ready.ready).toBe(true);
    expect(ready.blockers).toEqual([]);
  });
});
