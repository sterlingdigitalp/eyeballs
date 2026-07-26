import { describe, expect, it } from "vitest";
import {
  attachCandidateArchiveToExperimentNotes,
  emptyRatingSheet,
  measureEvaluatorConsistency,
  parseRatingSheetCsv,
  phase4CaptureChecklist,
  proposePhase4Decision,
  ratingSheetToCsv,
  sealCandidateArchive,
} from "./phase4-artifacts";
import { evaluationDimensions } from "./presenter-twin-experiment";

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
          providerId: "p",
          providerVersion: "1",
          seed: 1,
        },
      ],
    });
    expect(archive.archiveManifestSha256).toMatch(/^[a-f0-9]{64}$/i);
    const note = attachCandidateArchiveToExperimentNotes({
      experiment: {
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
      },
      archive,
    });
    expect(note.candidateCount).toBe(1);
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
    }).suggested).toBe("go");
  });
});
