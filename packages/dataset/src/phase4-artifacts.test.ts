import { describe, expect, it } from "vitest";
import {
  attachCandidateArchiveToExperimentNotes,
  beginBlindReviewSession,
  blindReviewRatingSheet,
  blankRatingSheetCsv,
  emptyRatingSheet,
  measureEvaluatorConsistency,
  mergePhase4RatingSheets,
  parseRatingSheetCsv,
  phase4CandidatesFromArchive,
  phase4CaptureChecklist,
  proposePhase4Decision,
  ratingSheetToCsv,
  recordBlindReviewRating,
  sealCandidateArchive,
  validateRatingSheetForSchedule,
  verifyCandidateArchive,
} from "./phase4-artifacts";
import {
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
});
