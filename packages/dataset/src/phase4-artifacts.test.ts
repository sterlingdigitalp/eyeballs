import { describe, expect, it } from "vitest";
import {
  attachCandidateArchiveToExperimentNotes,
  beginPhase4ExpertReview,
  beginBlindReviewSession,
  blindReviewRatingSheet,
  blankRatingSheetCsv,
  buildPhase4DecisionRecord,
  candidatesEligibleForAcceptance,
  emptyRatingSheet,
  finalizePhase4Decision,
  isAcceptableUseCaseDuration,
  measureEvaluatorConsistency,
  mergePhase4RatingSheets,
  parseRatingSheetCsv,
  phase4CandidatesFromArchive,
  phase4CaptureChecklist,
  proposePhase4Decision,
  ratingSheetToCsv,
  recordBlindReviewRating,
  resolvePhase4HumanGates,
  sealPhase4ExpertReview,
  sealCandidateArchive,
  upsertPhase4ExpertCandidateReview,
  validateRatingSheetForSchedule,
  verifyCandidateArchive,
  verifyPhase4ExpertReview,
  type Phase4DecisionRecord,
  type Phase4HumanGateEvidence,
} from "./phase4-artifacts";
import {
  createPhase4GoNoGoDraft,
  evaluationDimensions,
  type PresenterTwinExperiment,
} from "./presenter-twin-experiment";

const experiment = (): PresenterTwinExperiment => ({
  format: "presenter-twin-experiment/1.0.0",
  id: "exp-1",
  createdAt: "2026-07-26T12:00:00.000Z",
  sourcePackages: [],
  provider: {
    providerId: "p",
    providerVersion: "1",
    reviewedAt: "2026-07-26T12:00:00.000Z",
    localOrCloud: "local",
    acceptedSourceDurationSec: { min: 1, max: 60 },
    acceptedResolution: ["1920x1080"],
    acceptedCodecs: ["h264"],
    acceptsSegmentedSources: true,
    acceptsSeparateVoice: true,
    identityVerification: "x",
    retentionPolicy: "x",
    deletionPolicy: "x",
    outputRights: "x",
    estimatedCost: "0",
    watermarkOrProvenance: "x",
    workflow: "manual",
  },
  generationRequests: [],
  manifestSha256: "b".repeat(64),
});

describe("Phase 4 empirical artifacts", () => {
  it("builds a full rating sheet and CSV header", () => {
    const sheet = emptyRatingSheet({
      experimentId: "exp-1",
      blindIds: ["candidate-001", "candidate-002"],
      evaluatorId: "r1",
      createdAt: "2026-07-26T12:00:00.000Z",
    });
    expect(sheet.ratings).toHaveLength(2);
    expect(Object.keys(sheet.ratings[0].scores)).toEqual([
      ...evaluationDimensions,
    ]);
    const csv = ratingSheetToCsv(sheet);
    expect(csv.split("\n")[0]).toContain("camera_contact");
    expect(csv).toContain("candidate-001");
    const blank = blankRatingSheetCsv({
      blindIds: ["candidate-001"],
      evaluatorId: "r1",
    });
    expect(blank.split("\n")[1]).toContain("r1,candidate-001");
    expect(() => parseRatingSheetCsv(blank, "exp-1")).toThrow(/Invalid score/);
  });

  it("seals a candidate archive with content hash", async () => {
    const archive = await sealCandidateArchive({
      experimentId: "exp-1",
      createdAt: "2026-07-26T12:00:00.000Z",
      entries: [
        {
          candidateId: "c1",
          condition: "uncoached_baseline",
          playbackRelativePath: "candidates/c1.mp4",
          sha256: "a".repeat(64),
          durationSec: 30,
          providerId: "p",
          providerVersion: "1",
          seed: 1,
        },
      ],
    });
    expect(archive.archiveManifestSha256).toMatch(/^[a-f0-9]{64}$/i);
    const note = attachCandidateArchiveToExperimentNotes({
      experiment: experiment(),
      archive,
    });
    expect(note.candidateCount).toBe(1);
  });

  it("verifies archive content, A-D coverage, and provider lineage", async () => {
    const archive = await sealCandidateArchive({
      experimentId: "exp-1",
      createdAt: "2026-07-26T12:00:00.000Z",
      entries: [
        "uncoached_baseline",
        "coached_continuous",
        "curated_diverse",
        "real_reference",
      ].map((condition, index) => ({
        candidateId: `c${index + 1}`,
        condition: condition as
          | "uncoached_baseline"
          | "coached_continuous"
          | "curated_diverse"
          | "real_reference",
        playbackRelativePath: `candidates/c${index + 1}.mp4`,
        sha256: String(index + 1).repeat(64),
        durationSec: 30,
        providerId: condition === "real_reference" ? undefined : "p",
        providerVersion: condition === "real_reference" ? undefined : "1",
      })),
    });
    const verified = await verifyCandidateArchive({
      archive,
      experiment: experiment(),
    });
    expect(phase4CandidatesFromArchive(verified)).toHaveLength(4);
    await expect(
      verifyCandidateArchive({
        archive: {
          ...archive,
          entries: archive.entries.map((entry, index) =>
            index === 0 ? { ...entry, notes: "tampered" } : entry,
          ),
        },
        experiment: experiment(),
      }),
    ).rejects.toThrow(/SHA-256/);
    const wrongProvider = await sealCandidateArchive({
      ...archive,
      entries: archive.entries.map((entry, index) =>
        index === 0 ? { ...entry, providerId: "other" } : entry,
      ),
    });
    await expect(
      verifyCandidateArchive({
        archive: wrongProvider,
        experiment: experiment(),
      }),
    ).rejects.toThrow(/provider lineage/);
  });

  it("exposes the Phase 4 capture checklist", () => {
    const list = phase4CaptureChecklist();
    expect(list.some((item) => item.id === "condition_a")).toBe(true);
    expect(list.some((item) => item.id === "decision")).toBe(true);
  });

  it("round-trips rating CSV and measures consistency on repeats", () => {
    const sheet = emptyRatingSheet({
      experimentId: "exp-1",
      blindIds: ["candidate-001", "candidate-002"],
      evaluatorId: "r1",
      createdAt: "2026-07-26T12:00:00.000Z",
    });
    sheet.ratings[0].scores.overall_usefulness = 4;
    sheet.ratings[1].scores.overall_usefulness = 5;
    const parsed = parseRatingSheetCsv(
      ratingSheetToCsv(sheet),
      "exp-1",
      "2026-07-26T12:00:00.000Z",
    );
    expect(parsed.ratings).toHaveLength(2);
    const consistency = measureEvaluatorConsistency({
      ratings: [
        ...parsed.ratings,
        {
          ...parsed.ratings[0],
          blindId: "candidate-003",
          scores: {
            ...parsed.ratings[0].scores,
            overall_usefulness: 4,
          },
        },
      ],
      privateReveal: [
        { blindId: "candidate-001", candidateId: "c-a" },
        {
          blindId: "candidate-003",
          candidateId: "c-a",
          repeatedFromBlindId: "candidate-001",
        },
      ],
    });
    expect(consistency.pairsCompared).toBe(1);
    expect(consistency.meanAbsoluteDelta).toBe(0);
    expect(proposePhase4Decision({
      coachedWinRate: 0.8,
      decidedComparisons: 5,
      hasAcceptableCandidate: true,
      providerAcceptable: true,
      expertReviewComplete: true,
    }).suggested).toBe("go");
    expect(proposePhase4Decision({
      coachedWinRate: 0.8,
      decidedComparisons: 5,
      hasAcceptableCandidate: true,
      providerAcceptable: true,
    }).suggested).toBe("pending");
  });

  it("requires complete, unique ratings for every blind candidate", () => {
    const sheet = emptyRatingSheet({
      experimentId: "exp-1",
      blindIds: ["candidate-001", "candidate-002"],
      evaluatorId: "r1",
      createdAt: "2026-07-26T12:00:00.000Z",
    });
    const schedule = {
      format: "presenter-twin-blind-schedule/1.0.0" as const,
      experimentId: "exp-1",
      publicEntries: [
        { blindId: "candidate-001", playbackAssetId: "a.mp4" },
        { blindId: "candidate-002", playbackAssetId: "b.mp4" },
      ],
      privateReveal: [],
    };
    expect(
      validateRatingSheetForSchedule({ sheet, schedule }).ratings,
    ).toHaveLength(2);
    expect(() =>
      validateRatingSheetForSchedule({
        sheet: { ...sheet, ratings: sheet.ratings.slice(0, 1) },
        schedule,
      }),
    ).toThrow(/missing/);
    expect(() =>
      validateRatingSheetForSchedule({
        sheet: {
          ...sheet,
          ratings: [...sheet.ratings, sheet.ratings[0]],
        },
        schedule,
      }),
    ).toThrow(/more than once/);
  });

  it("records blind ratings in schedule order without reveal metadata", () => {
    let review = beginBlindReviewSession({
      experimentId: "exp-1",
      candidateArchiveManifestSha256: "a".repeat(64),
      evaluatorId: "reviewer-1",
      blindIds: [
        "candidate-001",
        "candidate-002",
        "candidate-003",
        "candidate-004",
      ],
      startedAt: "2026-07-26T12:00:00.000Z",
    });
    const scores = Object.fromEntries(
      evaluationDimensions.map((dimension) => [dimension, 4]),
    );
    for (let index = 0; index < 4; index += 1) {
      review = recordBlindReviewRating({
        session: review,
        scores,
        preferenceReason: `Review ${index + 1}`,
        ratedAt: `2026-07-26T12:0${index + 1}:00.000Z`,
      });
    }
    expect(review.status).toBe("complete");
    expect(JSON.stringify(review)).not.toContain("uncoached_baseline");
    const sheet = blindReviewRatingSheet(review);
    expect(sheet.ratings.map((rating) => rating.blindId)).toEqual([
      "candidate-001",
      "candidate-002",
      "candidate-003",
      "candidate-004",
    ]);
    const other = {
      ...sheet,
      ratings: sheet.ratings.map((rating) => ({
        ...rating,
        evaluatorId: "reviewer-2",
      })),
    };
    expect(mergePhase4RatingSheets([sheet, other]).ratings).toHaveLength(8);
    expect(() => mergePhase4RatingSheets([sheet, sheet])).toThrow(/Duplicate/);
  });

  it("seals timestamped expert artifact annotations against the candidate archive", async () => {
    const archive = await sealCandidateArchive({
      experimentId: "exp-1",
      createdAt: "2026-07-26T12:00:00.000Z",
      entries: [
        {
          candidateId: "c1",
          condition: "coached_continuous",
          playbackRelativePath: "candidates/c1.mp4",
          sha256: "a".repeat(64),
          durationSec: 30,
          providerId: "p",
          providerVersion: "1",
        },
      ],
    });
    let review = beginPhase4ExpertReview({
      experimentId: "exp-1",
      candidateArchiveManifestSha256: archive.archiveManifestSha256!,
      reviewerId: "expert-1",
      startedAt: "2026-07-26T13:00:00.000Z",
    });
    review = upsertPhase4ExpertCandidateReview({
      review,
      candidateReview: {
        candidateId: "c1",
        reviewedAt: "2026-07-26T13:02:00.000Z",
        disposition: "minor_edit",
        annotations: [
          {
            id: "artifact-1",
            candidateId: "c1",
            kind: "eye_flicker",
            startSec: 12.25,
            endSec: 12.8,
            severity: 2,
            notes: "Brief left-eye shimmer.",
          },
        ],
        notes: "Usable after trimming.",
      },
    });
    const sealed = await sealPhase4ExpertReview({
      review,
      archive,
      completedAt: "2026-07-26T13:03:00.000Z",
    });
    expect(sealed.status).toBe("complete");
    expect(sealed.reviewManifestSha256).toMatch(/^[a-f0-9]{64}$/i);
    await expect(
      verifyPhase4ExpertReview({ review: sealed, archive }),
    ).resolves.toEqual(sealed);
    await expect(
      verifyPhase4ExpertReview({
        review: {
          ...sealed,
          candidateReviews: sealed.candidateReviews.map((entry) => ({
            ...entry,
            notes: "tampered",
          })),
        },
        archive,
      }),
    ).rejects.toThrow(/SHA-256/);
    expect(() =>
      upsertPhase4ExpertCandidateReview({
        review: sealed,
        candidateReview: sealed.candidateReviews[0],
      }),
    ).toThrow(/immutable/);
  });

  it("rejects incomplete or out-of-range expert review coverage", async () => {
    const archive = await sealCandidateArchive({
      experimentId: "exp-1",
      createdAt: "2026-07-26T12:00:00.000Z",
      entries: [
        {
          candidateId: "c1",
          condition: "coached_continuous",
          playbackRelativePath: "candidates/c1.mp4",
          sha256: "a".repeat(64),
          durationSec: 10,
          providerId: "p",
          providerVersion: "1",
        },
      ],
    });
    const empty = beginPhase4ExpertReview({
      experimentId: "exp-1",
      candidateArchiveManifestSha256: archive.archiveManifestSha256!,
      reviewerId: "expert-1",
    });
    await expect(
      sealPhase4ExpertReview({ review: empty, archive }),
    ).rejects.toThrow(/missing candidate/);
    const outOfRange = upsertPhase4ExpertCandidateReview({
      review: empty,
      candidateReview: {
        candidateId: "c1",
        reviewedAt: "2026-07-26T13:00:00.000Z",
        disposition: "unusable",
        annotations: [
          {
            id: "artifact-1",
            candidateId: "c1",
            kind: "identity_drift",
            startSec: 9,
            endSec: 11,
            severity: 5,
          },
        ],
      },
    });
    await expect(
      sealPhase4ExpertReview({ review: outOfRange, archive }),
    ).rejects.toThrow(/exceeds/);
  });

  it("enforces 10–60s acceptable-candidate duration and human gates for go", async () => {
    expect(isAcceptableUseCaseDuration(9.9)).toBe(false);
    expect(isAcceptableUseCaseDuration(10)).toBe(true);
    expect(isAcceptableUseCaseDuration(60)).toBe(true);
    expect(isAcceptableUseCaseDuration(60.1)).toBe(false);

    const archive = await sealCandidateArchive({
      experimentId: "exp-1",
      createdAt: "2026-07-26T12:00:00.000Z",
      entries: [
        "uncoached_baseline",
        "coached_continuous",
        "curated_diverse",
        "real_reference",
      ].map((condition, index) => ({
        candidateId: `c${index + 1}`,
        condition: condition as
          | "uncoached_baseline"
          | "coached_continuous"
          | "curated_diverse"
          | "real_reference",
        playbackRelativePath: `candidates/c${index + 1}.mp4`,
        sha256: String(index + 1).repeat(64),
        durationSec: index === 0 ? 5 : 30,
        providerId: condition === "real_reference" ? undefined : "p",
        providerVersion: condition === "real_reference" ? undefined : "1",
      })),
    });
    // real_reference (c4) is never eligible even at 30s — §14.9 generated only.
    expect(
      candidatesEligibleForAcceptance(archive).map((entry) => entry.candidateId),
    ).toEqual(["c2", "c3"]);
    expect(
      candidatesEligibleForAcceptance(archive).some(
        (entry) => entry.condition === "real_reference",
      ),
    ).toBe(false);
    expect(() =>
      resolvePhase4HumanGates({
        acceptableCandidateSelection: "c1",
        providerDisposition: "acceptable",
        expertReviewComplete: true,
        archive,
      }),
    ).toThrow(/10–60s/);
    expect(() =>
      resolvePhase4HumanGates({
        acceptableCandidateSelection: "c4",
        providerDisposition: "acceptable",
        expertReviewComplete: true,
        archive,
      }),
    ).toThrow(/real-video reference|generated condition/);

    const gates = resolvePhase4HumanGates({
      acceptableCandidateSelection: "c2",
      providerDisposition: "acceptable",
      expertReviewComplete: true,
      expertReviewManifestSha256: "e".repeat(64),
      archive,
      reviewedAt: "2026-07-26T13:00:00.000Z",
    });
    expect(gates.hasAcceptableCandidate).toBe(true);
    expect(gates.evidence.acceptableCandidateDurationSec).toBe(30);
    expect(gates.evidence.acceptableCandidateId).toBe("c2");
    expect(gates.evidence.acceptableCandidateCondition).toBe(
      "coached_continuous",
    );

    const proposal = proposePhase4Decision({
      coachedWinRate: 0.8,
      decidedComparisons: 5,
      hasAcceptableCandidate: gates.hasAcceptableCandidate,
      providerAcceptable: gates.providerAcceptable,
      expertReviewComplete: gates.expertReviewComplete,
    });
    expect(proposal.suggested).toBe("go");

    const record = buildPhase4DecisionRecord({
      experiment: experiment(),
      coachedVsBaseline: {
        coachedWins: 4,
        baselineWins: 1,
        ties: 0,
        coachedWinRate: 0.8,
      },
      proposal,
      humanGateEvidence: gates.evidence,
      candidateArchiveManifestSha256: archive.archiveManifestSha256,
      createdAt: "2026-07-26T13:00:00.000Z",
    });
    expect(record.decision).toBe("pending");
    expect(record.softwareSuggestion.suggested).toBe("go");
    expect(record.experimentManifestSha256).toBe(experiment().manifestSha256);
    expect(record.candidateArchiveManifestSha256).toBe(
      archive.archiveManifestSha256,
    );
    expect(record.humanGateEvidence.candidateDisposition).toBe("acceptable");

    // Auto-go is impossible: software suggestion never becomes decision.
    expect(record.decision).not.toBe("go");

    expect(() =>
      finalizePhase4Decision({
        record: {
          ...record,
          humanGateEvidence: {
            ...record.humanGateEvidence,
            expertReviewManifestSha256: undefined,
          },
        },
        decision: "go",
        decisionRationale: "No sealed review evidence.",
        decidedBy: "reviewer-1",
      }),
    ).toThrow(/sealed expert review SHA-256/);

    const finalized = finalizePhase4Decision({
      record,
      decision: "go",
      decisionRationale: "Human confirms coached majority and usable candidate.",
      decidedBy: "reviewer-1",
    });
    expect(finalized.decision).toBe("go");
    expect(finalized.decidedBy).toBe("reviewer-1");
    expect(finalized.decidedAt).toMatch(/^20/);
    expect(() =>
      finalizePhase4Decision({
        record: finalized,
        decision: "no_go",
        decisionRationale: "try to revise",
        decidedBy: "reviewer-2",
      }),
    ).toThrow(/immutable/);
    expect(() =>
      finalizePhase4Decision({
        record,
        decision: "no_go",
        decisionRationale: " ",
        decidedBy: "reviewer-1",
      }),
    ).toThrow(/rationale/);
    expect(() =>
      finalizePhase4Decision({
        record,
        decision: "no_go",
        decisionRationale: "Human rejection.",
        decidedBy: " ",
      }),
    ).toThrow(/reviewer identity/);

    const ungated = buildPhase4DecisionRecord({
      experiment: experiment(),
      coachedVsBaseline: {
        coachedWins: 4,
        baselineWins: 1,
        ties: 0,
        coachedWinRate: 0.8,
      },
      proposal: { suggested: "go", rationale: "would go if gates set" },
      humanGateEvidence: resolvePhase4HumanGates({
        acceptableCandidateSelection: "__unreviewed__",
        providerDisposition: "__unreviewed__",
        expertReviewComplete: false,
      }).evidence,
      createdAt: "2026-07-26T13:00:00.000Z",
    });
    expect(() =>
      finalizePhase4Decision({
        record: ungated,
        decision: "go",
        decisionRationale: "try auto go",
        decidedBy: "reviewer-1",
      }),
    ).toThrow(/acceptable 10–60s candidate/);
  });

  it("blocks go suggestion when any human gate is unset", () => {
    expect(
      proposePhase4Decision({
        coachedWinRate: 1,
        decidedComparisons: 10,
        hasAcceptableCandidate: true,
        providerAcceptable: true,
        expertReviewComplete: false,
      }).suggested,
    ).toBe("pending");
    expect(
      proposePhase4Decision({
        coachedWinRate: 1,
        decidedComparisons: 10,
        hasAcceptableCandidate: true,
        providerAcceptable: undefined,
        expertReviewComplete: true,
      }).suggested,
    ).toBe("pending");
    expect(
      proposePhase4Decision({
        coachedWinRate: 1,
        decidedComparisons: 10,
        hasAcceptableCandidate: undefined,
        providerAcceptable: true,
        expertReviewComplete: true,
      }).suggested,
    ).toBe("pending");
    expect(
      proposePhase4Decision({
        coachedWinRate: 1,
        decidedComparisons: 10,
        hasAcceptableCandidate: false,
        providerAcceptable: true,
        expertReviewComplete: true,
      }).suggested,
    ).toBe("no_go");
  });

  it("rejects finalize go with disposition acceptable but incomplete evidence", () => {
    const baseEvidence: Phase4HumanGateEvidence = {
      reviewedAt: "2026-07-26T13:00:00.000Z",
      acceptableCandidateId: null,
      candidateDisposition: "acceptable",
      providerDisposition: "acceptable",
      expertReviewComplete: true,
      // deliberately omit duration and condition
    };
    const incompleteRecord: Phase4DecisionRecord = {
      format: "presenter-twin-go-no-go/1.0.0",
      experimentId: "exp-1",
      createdAt: "2026-07-26T13:00:00.000Z",
      thesis: "test",
      conditions: [
        "uncoached_baseline",
        "coached_continuous",
        "curated_diverse",
        "real_reference",
      ],
      decision: "pending",
      decisionRationale: "pending",
      openRisks: [],
      softwareSuggestion: { suggested: "go", rationale: "stats" },
      experimentManifestSha256: "b".repeat(64),
      humanGateEvidence: baseEvidence,
    };
    expect(() =>
      finalizePhase4Decision({
        record: incompleteRecord,
        decision: "go",
        decisionRationale: "crafted incomplete go",
        decidedBy: "reviewer-1",
      }),
    ).toThrow(/acceptable candidate id/);

    expect(() =>
      finalizePhase4Decision({
        record: {
          ...incompleteRecord,
          humanGateEvidence: {
            ...baseEvidence,
            acceptableCandidateId: "crafted",
            // still missing duration
          },
        },
        decision: "go",
        decisionRationale: "missing duration",
        decidedBy: "reviewer-1",
      }),
    ).toThrow(/duration/);

    expect(() =>
      finalizePhase4Decision({
        record: {
          ...incompleteRecord,
          humanGateEvidence: {
            ...baseEvidence,
            acceptableCandidateId: "crafted",
            acceptableCandidateDurationSec: 30,
            acceptableCandidateCondition: "real_reference",
          },
        },
        decision: "go",
        decisionRationale: "real ref as acceptable",
        decidedBy: "reviewer-1",
      }),
    ).toThrow(/generated|real-reference|non-real-reference/);
  });

  it("createPhase4GoNoGoDraft cannot publish decision go without gates", () => {
    const draft = createPhase4GoNoGoDraft({
      experiment: experiment(),
      decision: "go",
      decisionRationale: "try to force go",
    });
    expect(draft.decision).toBe("pending");
    expect(draft.decision).not.toBe("go");
    expect(draft.openRisks.join(" ")).toMatch(/finalizePhase4Decision/);
  });
});
