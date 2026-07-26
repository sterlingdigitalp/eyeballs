import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClipCandidate,
  RecordingAsset,
} from "../../../../packages/contracts/src";
import {
  attachCandidateArchiveToExperimentNotes,
  auditPresenterTwinReadiness,
  beginBlindReviewSession,
  blindReviewRatingSheet,
  blankRatingSheetCsv,
  buildBlindEvaluationSchedule,
  createPhase4GoNoGoDraft,
  createPresenterTwinExperiment,
  expertArtifactChecklist,
  evaluationDimensions,
  measureEvaluatorConsistency,
  mergePhase4RatingSheets,
  parseRatingSheet,
  parseRatingSheetCsv,
  phase4BlindReviewSessionSchema,
  phase4CandidatesFromArchive,
  phase4CaptureChecklist,
  proposePhase4Decision,
  publicBlindScheduleArtifact,
  ratingSheetToCsv,
  recordBlindReviewRating,
  phase4ProviderRequirementsSchema,
  sha256Hex,
  summarizeCoachedVsBaseline,
  validateRatingSheetForSchedule,
  verifyCandidateArchive,
  type BlindEvaluationSchedule,
  type DatasetVersionManifest,
  type EvaluationDimension,
  type Phase4BlindReviewSession,
  type Phase4CandidateArchive,
  type Phase4RatingSheet,
  type Phase4SourcePackage,
  type PresenterTwinExperiment,
} from "../../../../packages/dataset/src";
import { store, type StoredSession } from "../lib/store";

const providerTemplate = JSON.stringify(
  {
    providerId: "",
    providerVersion: "",
    reviewedAt: new Date().toISOString(),
    localOrCloud: "local",
    acceptedSourceDurationSec: { min: 10, max: 600 },
    acceptedResolution: ["1920x1080"],
    acceptedCodecs: ["h264"],
    acceptsSegmentedSources: true,
    acceptsSeparateVoice: true,
    identityVerification: "Document before use",
    retentionPolicy: "Document before use",
    deletionPolicy: "Document before use",
    outputRights: "Document before use",
    estimatedCost: "Document before use",
    watermarkOrProvenance: "Document before use",
    workflow: "manual",
  },
  null,
  2,
);

function firstClipId(clips: ClipCandidate[], sessionId: string): string {
  return clips.find((clip) => clip.sessionId === sessionId)?.id ?? "";
}

function validAssetIds(
  assets: RecordingAsset[],
  sessionIds: string[],
): string[] {
  return assets
    .filter(
      (asset) =>
        sessionIds.includes(asset.sessionId) &&
        asset.validationState === "valid" &&
        Boolean(asset.sha256),
    )
    .map((asset) => asset.id);
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadExperiment(experiment: PresenterTwinExperiment): void {
  downloadJson(`${experiment.id}.json`, experiment);
  const draft = createPhase4GoNoGoDraft({ experiment });
  downloadJson(`${experiment.id}-go-no-go-draft.json`, draft);
}

function archiveBoundKey(
  kind: "presenterTwinBlindSchedule" | "presenterTwinRatings",
  experimentId: string,
  archiveManifestSha256: string,
): string {
  return `${kind}:${experimentId}:${archiveManifestSha256}`;
}

function blindReviewKey(
  experimentId: string,
  archiveManifestSha256: string,
  evaluatorId: string,
): string {
  return `presenterTwinBlindReview:${experimentId}:${archiveManifestSha256}:${evaluatorId}`;
}

const emptyBlindScores = (): Partial<Record<EvaluationDimension, number>> =>
  Object.fromEntries(evaluationDimensions.map((dimension) => [dimension, undefined]));

const dimensionLabel = (dimension: EvaluationDimension): string =>
  dimension === "artifact_burden"
    ? "artifact freedom (low burden)"
    : dimension.replaceAll("_", " ");

export function PresenterTwinPanel({
  sessions,
  clips,
  assets,
}: {
  sessions: StoredSession[];
  clips: ClipCandidate[];
  assets: RecordingAsset[];
}) {
  const [versions, setVersions] = useState<DatasetVersionManifest[]>([]);
  const [uncoachedSessionId, setUncoachedSessionId] = useState("");
  const [coachedSessionId, setCoachedSessionId] = useState("");
  const [curatedDatasetVersion, setCuratedDatasetVersion] = useState<number>();
  const [realReferenceSessionId, setRealReferenceSessionId] = useState("");
  const [voiceAssetId, setVoiceAssetId] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [scriptSha256, setScriptSha256] = useState("");
  const [providerJson, setProviderJson] = useState(providerTemplate);
  const [message, setMessage] = useState<string>();
  const [lastExperiment, setLastExperiment] =
    useState<PresenterTwinExperiment>();
  const [privateReveal, setPrivateReveal] = useState<
    BlindEvaluationSchedule["privateReveal"]
  >([]);
  const [blindSchedule, setBlindSchedule] =
    useState<BlindEvaluationSchedule>();
  const [candidateArchive, setCandidateArchive] =
    useState<Phase4CandidateArchive>();
  const [importedRatings, setImportedRatings] = useState<Phase4RatingSheet>();
  const [evaluationSummary, setEvaluationSummary] = useState<string>();
  const [acceptableCandidate, setAcceptableCandidate] =
    useState("__unreviewed__");
  const [providerDisposition, setProviderDisposition] =
    useState("__unreviewed__");
  const [expertReviewComplete, setExpertReviewComplete] = useState(false);
  const [candidateMediaUrls, setCandidateMediaUrls] = useState<
    Record<string, string>
  >({});
  const candidateMediaUrlsRef = useRef<Record<string, string>>({});
  const [evaluatorId, setEvaluatorId] = useState("");
  const [blindReview, setBlindReview] =
    useState<Phase4BlindReviewSession>();
  const [blindReviewVisible, setBlindReviewVisible] = useState(false);
  const [blindScores, setBlindScores] = useState(emptyBlindScores);
  const [blindReason, setBlindReason] = useState("");
  const [blindReviewError, setBlindReviewError] = useState<string>();

  useEffect(() => {
    void store.datasetVersions.all().then((raw) => {
      setVersions(raw as DatasetVersionManifest[]);
    });
    void store.settings
      .get<PresenterTwinExperiment[]>("presenterTwinExperiments")
      .then((existing) => {
        if (existing?.[0]) setLastExperiment(existing[0]);
      });
  }, []);

  useEffect(() => {
    if (!lastExperiment) return;
    void store.settings
      .get<Phase4CandidateArchive>(
        `presenterTwinCandidates:${lastExperiment.id}`,
      )
      .then(async (archive) => {
        try {
          const verifiedArchive = archive
            ? await verifyCandidateArchive({
                archive,
                experiment: lastExperiment,
              })
            : undefined;
          if (!verifiedArchive?.archiveManifestSha256) return;
          setCandidateArchive(verifiedArchive);
          const [ratings, schedule] = await Promise.all([
            store.settings.get<Phase4RatingSheet>(
              archiveBoundKey(
                "presenterTwinRatings",
                lastExperiment.id,
                verifiedArchive.archiveManifestSha256,
              ),
            ),
            store.settings.get<BlindEvaluationSchedule>(
              archiveBoundKey(
                "presenterTwinBlindSchedule",
                lastExperiment.id,
                verifiedArchive.archiveManifestSha256,
              ),
            ),
          ]);
          if (ratings && schedule) {
            setImportedRatings(
              validateRatingSheetForSchedule({ sheet: ratings, schedule }),
            );
          }
          if (schedule) {
            setBlindSchedule(schedule);
            setPrivateReveal(schedule.privateReveal);
          }
        } catch (cause) {
          setMessage(
            `Saved Phase 4 evaluation state was rejected: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          );
        }
      });
  }, [lastExperiment]);

  useEffect(
    () => () => {
      Object.values(candidateMediaUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    },
    [],
  );

  useEffect(() => {
    let active = true;
    if (!scriptText.trim()) {
      setScriptSha256("");
      return () => {
        active = false;
      };
    }
    void sha256Hex(new TextEncoder().encode(scriptText)).then((digest) => {
      if (active) setScriptSha256(digest);
    });
    return () => {
      active = false;
    };
  }, [scriptText]);

  const provider = useMemo(() => {
    try {
      return JSON.parse(providerJson) as unknown;
    } catch {
      return undefined;
    }
  }, [providerJson]);

  const readiness = useMemo(
    () =>
      auditPresenterTwinReadiness({
        sessions: sessions.map((session) => session.manifest),
        clips,
        assets,
        datasetVersions: versions,
        uncoachedSessionId: uncoachedSessionId || undefined,
        coachedSessionId: coachedSessionId || undefined,
        curatedDatasetVersion,
        realReferenceSessionId: realReferenceSessionId || undefined,
        scriptSha256: scriptSha256 || undefined,
        voiceAssetId: voiceAssetId || undefined,
        provider,
      }),
    [
      assets,
      clips,
      coachedSessionId,
      curatedDatasetVersion,
      provider,
      realReferenceSessionId,
      scriptSha256,
      sessions,
      uncoachedSessionId,
      versions,
      voiceAssetId,
    ],
  );

  const createExperiment = async () => {
    if (!readiness.ready) {
      setMessage(`Not ready: ${readiness.blockers.join("; ")}`);
      return;
    }
    try {
      const parsedProvider = phase4ProviderRequirementsSchema.parse(provider);
      const createdAt = new Date().toISOString();
      const experimentId = `presenter-twin-${createdAt.replace(/[:.]/g, "-")}`;
      const script = {
        id: `script-${scriptSha256.slice(0, 12)}`,
        sha256: scriptSha256,
      };
      const output = {
        width: 1920,
        height: 1080,
        fps: 30,
        durationSec: 30,
      };
      const curatedVersion = versions.find(
        (version) => version.version === curatedDatasetVersion,
      )!;
      const sources: Phase4SourcePackage[] = [
        {
          id: `${experimentId}-a`,
          condition: "uncoached_baseline",
          createdAt,
          sourceSessionIds: [uncoachedSessionId],
          clipIds: [firstClipId(clips, uncoachedSessionId)],
          assetIds: validAssetIds(assets, [uncoachedSessionId]),
          coached: false,
          curated: false,
          continuousTake: false,
          realReference: false,
          script,
          voiceAssetId,
          output,
        },
        {
          id: `${experimentId}-b`,
          condition: "coached_continuous",
          createdAt,
          sourceSessionIds: [coachedSessionId],
          clipIds: [firstClipId(clips, coachedSessionId)],
          assetIds: validAssetIds(assets, [coachedSessionId]),
          coached: true,
          curated: false,
          continuousTake: true,
          realReference: false,
          script,
          voiceAssetId,
          output,
        },
        {
          id: `${experimentId}-c`,
          condition: "curated_diverse",
          createdAt,
          sourceSessionIds: curatedVersion.sourceSessionIds,
          clipIds: curatedVersion.clipIds,
          assetIds: validAssetIds(assets, curatedVersion.sourceSessionIds),
          datasetVersionId: curatedVersion.id,
          datasetManifestSha256: curatedVersion.manifestSha256,
          coached: true,
          curated: true,
          continuousTake: false,
          realReference: false,
          script,
          voiceAssetId,
          output,
        },
        {
          id: `${experimentId}-d`,
          condition: "real_reference",
          createdAt,
          sourceSessionIds: [realReferenceSessionId],
          clipIds: [firstClipId(clips, realReferenceSessionId)],
          assetIds: validAssetIds(assets, [realReferenceSessionId]),
          coached: false,
          curated: false,
          continuousTake: true,
          realReference: true,
          script,
          output,
        },
      ];
      const experiment = await createPresenterTwinExperiment({
        id: experimentId,
        createdAt,
        sourcePackages: sources,
        provider: parsedProvider,
      });
      const existing =
        (await store.settings.get<PresenterTwinExperiment[]>(
          "presenterTwinExperiments",
        )) ?? [];
      await store.settings.put("presenterTwinExperiments", [
        experiment,
        ...existing.filter((entry) => entry.id !== experiment.id),
      ]);
      setLastExperiment(experiment);
      downloadExperiment(experiment);
      setMessage(
        `Created ${experiment.id} · ${experiment.generationRequests.length} reproducible generation requests · ${experiment.manifestSha256.slice(0, 12)}… · go/no-go draft downloaded`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const completeSessions = sessions.filter(
    (session) => session.manifest.status === "complete",
  );
  const voiceAssets = assets.filter(
    (asset) =>
      asset.role === "master_audio" &&
      asset.validationState === "valid" &&
      Boolean(asset.sha256),
  );

  const checklist = phase4CaptureChecklist();
  const expertChecklist = expertArtifactChecklist();

  const importReveal = async (file: File | undefined) => {
    if (!file || !lastExperiment || !candidateArchive) return;
    try {
      const raw = JSON.parse(await file.text()) as {
        experimentId?: string;
        privateReveal?: BlindEvaluationSchedule["privateReveal"];
      };
      if (raw.experimentId !== lastExperiment.id) {
        throw new Error("Private reveal does not match the active experiment");
      }
      if (!raw.privateReveal?.length) {
        throw new Error("File missing privateReveal array");
      }
      const candidates = new Map(
        phase4CandidatesFromArchive(candidateArchive).map((candidate) => [
          candidate.id,
          candidate,
        ]),
      );
      const publicEntries = raw.privateReveal.map((entry) => {
        const candidate = candidates.get(entry.candidateId);
        if (!candidate) {
          throw new Error(
            `Private reveal references unknown candidate ${entry.candidateId}`,
          );
        }
        return {
          blindId: entry.blindId,
          playbackAssetId: candidate.playbackAssetId,
        };
      });
      const schedule: BlindEvaluationSchedule = {
        format: "presenter-twin-blind-schedule/1.0.0",
        experimentId: lastExperiment.id,
        publicEntries,
        privateReveal: raw.privateReveal,
      };
      setPrivateReveal(raw.privateReveal);
      setBlindSchedule(schedule);
      await store.settings.put(
        archiveBoundKey(
          "presenterTwinBlindSchedule",
          lastExperiment.id,
          candidateArchive.archiveManifestSha256!,
        ),
        schedule,
      );
      setMessage(
        `Loaded private reveal with ${raw.privateReveal.length} entries — keep offline.`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importRatings = async (file: File | undefined) => {
    if (!file || !lastExperiment || !candidateArchive || !blindSchedule) return;
    try {
      const text = await file.text();
      const sheet = file.name.endsWith(".csv")
        ? parseRatingSheetCsv(text, lastExperiment.id)
        : parseRatingSheet(JSON.parse(text));
      if (sheet.experimentId !== lastExperiment.id) {
        throw new Error(
          `Rating sheet experiment ${sheet.experimentId} does not match ${lastExperiment.id}`,
        );
      }
      const validated = validateRatingSheetForSchedule({
        sheet,
        schedule: blindSchedule,
      });
      setImportedRatings(validated);
      await store.settings.put(
        archiveBoundKey(
          "presenterTwinRatings",
          lastExperiment.id,
          candidateArchive.archiveManifestSha256!,
        ),
        validated,
      );
      setMessage(
        `Imported ${validated.ratings.length} complete blind ratings for ${lastExperiment.id.slice(0, 18)}…`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importCandidateArchive = async (file: File | undefined) => {
    if (!file || !lastExperiment) return;
    try {
      const archive = await verifyCandidateArchive({
        archive: JSON.parse(await file.text()),
        experiment: lastExperiment,
      });
      const note = attachCandidateArchiveToExperimentNotes({
        experiment: lastExperiment,
        archive,
      });
      await store.settings.put(
        `presenterTwinCandidates:${lastExperiment.id}`,
        archive,
      );
      setCandidateArchive(archive);
      setBlindSchedule(undefined);
      setPrivateReveal([]);
      setImportedRatings(undefined);
      setAcceptableCandidate("__unreviewed__");
      Object.values(candidateMediaUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
      candidateMediaUrlsRef.current = {};
      setCandidateMediaUrls({});
      setBlindReview(undefined);
      setMessage(
        `Verified candidate archive attached · ${note.candidateCount} entries · hash ${note.archiveManifestSha256?.slice(0, 12) ?? "n/a"}…`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const attachCandidateMedia = async (files: FileList | null) => {
    if (!candidateArchive || !files?.length) return;
    try {
      const selected = [...files];
      const basenameCounts = new Map<string, number>();
      for (const entry of candidateArchive.entries) {
        const basename = entry.playbackRelativePath.split("/").at(-1)!;
        basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
      }
      const matched = new Map<string, File>();
      for (const entry of candidateArchive.entries) {
        const basename = entry.playbackRelativePath.split("/").at(-1)!;
        const file = selected.find((candidate) => {
          const relative = candidate.webkitRelativePath.replaceAll("\\", "/");
          return (
            relative === entry.playbackRelativePath ||
            relative.endsWith(`/${entry.playbackRelativePath}`) ||
            (basenameCounts.get(basename) === 1 && candidate.name === basename)
          );
        });
        if (!file) {
          throw new Error(
            `Missing candidate media ${entry.playbackRelativePath}`,
          );
        }
        matched.set(entry.playbackRelativePath, file);
      }

      const verified: Array<readonly [string, File]> = [];
      // Hash sequentially so several large generated clips are not all held in
      // memory at once by Web Crypto.
      for (const entry of candidateArchive.entries) {
        const file = matched.get(entry.playbackRelativePath)!;
        const digest = await sha256Hex(
          new Uint8Array(await file.arrayBuffer()),
        );
        if (digest !== entry.sha256.toLowerCase()) {
          throw new Error(
            `Media SHA-256 mismatch for ${entry.playbackRelativePath}`,
          );
        }
        verified.push([entry.playbackRelativePath, file] as const);
      }
      const nextUrls = Object.fromEntries(
        verified.map(([path, file]) => [path, URL.createObjectURL(file)]),
      );
      Object.values(candidateMediaUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
      candidateMediaUrlsRef.current = nextUrls;
      setCandidateMediaUrls(nextUrls);
      setMessage(
        `Attached and SHA-256 verified ${verified.length} local candidate videos. Files remain browser-local and must be reattached after restart.`,
      );
    } catch (cause) {
      setMessage(
        `Candidate media rejected: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const startBlindReview = async () => {
    if (
      !lastExperiment ||
      !candidateArchive?.archiveManifestSha256 ||
      !blindSchedule
    ) {
      setMessage("Verify candidates and create a blind schedule first.");
      return;
    }
    const reviewer = evaluatorId.trim();
    if (!reviewer) {
      setMessage("Enter a stable evaluator ID.");
      return;
    }
    const missingMedia = blindSchedule.publicEntries.filter(
      (entry) => !candidateMediaUrls[entry.playbackAssetId],
    );
    if (missingMedia.length) {
      setMessage("Attach and verify every candidate video before review.");
      return;
    }
    if (
      importedRatings?.ratings.some(
        (rating) => rating.evaluatorId === reviewer,
      )
    ) {
      setMessage(
        `Evaluator ${reviewer} already has a completed rating set; use a unique ID.`,
      );
      return;
    }
    const key = blindReviewKey(
      lastExperiment.id,
      candidateArchive.archiveManifestSha256,
      reviewer,
    );
    try {
      const stored = await store.settings.get<unknown>(key);
      const session = stored
        ? phase4BlindReviewSessionSchema.parse(stored)
        : beginBlindReviewSession({
            experimentId: lastExperiment.id,
            candidateArchiveManifestSha256:
              candidateArchive.archiveManifestSha256,
            evaluatorId: reviewer,
            blindIds: blindSchedule.publicEntries.map(
              (entry) => entry.blindId,
            ),
          });
      if (
        session.experimentId !== lastExperiment.id ||
        session.candidateArchiveManifestSha256 !==
          candidateArchive.archiveManifestSha256 ||
        session.blindIds.join("|") !==
          blindSchedule.publicEntries
            .map((entry) => entry.blindId)
            .join("|")
      ) {
        throw new Error("Saved blind review does not match the active schedule");
      }
      if (session.status === "complete") {
        throw new Error("This evaluator already completed the blind review");
      }
      setBlindReview(session);
      setBlindScores(emptyBlindScores());
      setBlindReason("");
      setBlindReviewError(undefined);
      setBlindReviewVisible(true);
      await store.settings.put(key, session);
    } catch (cause) {
      setMessage(
        `Blind review could not start: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const submitBlindRating = async () => {
    if (
      !blindReview ||
      !lastExperiment ||
      !candidateArchive?.archiveManifestSha256 ||
      !blindSchedule
    ) {
      return;
    }
    if (
      evaluationDimensions.some(
        (dimension) => blindScores[dimension] === undefined,
      )
    ) {
      setBlindReviewError("Rate every dimension from 1 to 5.");
      return;
    }
    try {
      const next = recordBlindReviewRating({
        session: blindReview,
        scores: Object.fromEntries(
          evaluationDimensions.map((dimension) => [
            dimension,
            blindScores[dimension]!,
          ]),
        ),
        preferenceReason: blindReason,
      });
      const reviewKey = blindReviewKey(
        lastExperiment.id,
        candidateArchive.archiveManifestSha256,
        blindReview.evaluatorId,
      );
      await store.settings.put(reviewKey, next);
      if (next.status === "complete") {
        const completed = blindReviewRatingSheet(next);
        const merged = importedRatings
          ? mergePhase4RatingSheets([importedRatings, completed])
          : completed;
        const validated = validateRatingSheetForSchedule({
          sheet: merged,
          schedule: blindSchedule,
        });
        await store.settings.put(
          archiveBoundKey(
            "presenterTwinRatings",
            lastExperiment.id,
            candidateArchive.archiveManifestSha256,
          ),
          validated,
        );
        setImportedRatings(validated);
        downloadJson(
          `${lastExperiment.id}-${next.evaluatorId}-ratings.json`,
          completed,
        );
        const csv = ratingSheetToCsv(completed);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${lastExperiment.id}-${next.evaluatorId}-ratings.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
        setBlindReview(undefined);
        setBlindReviewVisible(false);
        setMessage(
          `Blind review complete for ${next.evaluatorId}; ratings autosaved and exported without reveal metadata.`,
        );
        return;
      }
      setBlindReview(next);
      setBlindScores(emptyBlindScores());
      setBlindReason("");
      setBlindReviewError(undefined);
    } catch (cause) {
      setBlindReviewError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  };

  const computeEvaluation = async () => {
    if (!lastExperiment) {
      setMessage("Create or load an experiment first.");
      return;
    }
    if (!importedRatings?.ratings.length) {
      setMessage("Import a filled rating sheet first.");
      return;
    }
    if (!blindSchedule || !privateReveal.length) {
      setMessage("Import the private reveal key first.");
      return;
    }
    type RatingScores = Parameters<
      typeof summarizeCoachedVsBaseline
    >[0]["ratings"][number]["scores"];
    const summary = summarizeCoachedVsBaseline({
      schedule: blindSchedule,
      ratings: importedRatings.ratings.map((rating) => ({
        evaluatorId: rating.evaluatorId,
        blindId: rating.blindId,
        scores: rating.scores as RatingScores,
        preferenceReason: rating.preferenceReason,
      })),
    });
    const consistency = measureEvaluatorConsistency({
      ratings: importedRatings.ratings,
      privateReveal,
    });
    const decided = summary.coachedWins + summary.baselineWins;
    const proposal = proposePhase4Decision({
      coachedWinRate: summary.coachedWinRate,
      decidedComparisons: decided,
      consistency,
      hasAcceptableCandidate:
        acceptableCandidate === "__unreviewed__"
          ? undefined
          : acceptableCandidate !== "__none__",
      providerAcceptable:
        providerDisposition === "__unreviewed__"
          ? undefined
          : providerDisposition === "acceptable",
      expertReviewComplete,
    });
    const report = createPhase4GoNoGoDraft({
      experiment: lastExperiment,
      coachedVsBaseline: summary,
      suggestedDecision: proposal.suggested,
      decisionRationale: proposal.rationale,
      openRisks: [
        ...(consistency.pairsCompared === 0
          ? ["No repeated-candidate consistency pairs in ratings"]
          : []),
        ...(acceptableCandidate === "__unreviewed__"
          ? ["Candidate usability has not been reviewed"]
          : acceptableCandidate === "__none__"
            ? ["No candidate is acceptable for the intended use case"]
            : []),
        ...(providerDisposition === "__unreviewed__"
          ? ["Provider policy has not been accepted or rejected"]
          : providerDisposition === "unacceptable"
            ? ["Provider data-control or rights posture is unacceptable"]
            : []),
        ...(!expertReviewComplete
          ? ["Expert frame-by-frame artifact review is incomplete"]
          : []),
        "Human must confirm the final published decision",
      ],
    });
    const humanGateEvidence = {
      reviewedAt: new Date().toISOString(),
      acceptableCandidateId:
        acceptableCandidate.startsWith("__") ? null : acceptableCandidate,
      candidateDisposition:
        acceptableCandidate === "__unreviewed__"
          ? "unreviewed"
          : acceptableCandidate === "__none__"
            ? "none_acceptable"
            : "acceptable",
      providerDisposition:
        providerDisposition === "__unreviewed__"
          ? "unreviewed"
          : providerDisposition,
      expertReviewComplete,
    };
    const resultArtifact = {
      ...report,
      softwareSuggestion: proposal,
      evaluatorConsistency: consistency,
      candidateArchiveManifestSha256:
        candidateArchive?.archiveManifestSha256,
      humanGateEvidence,
    };
    await store.settings.put(
      `presenterTwinEvaluation:${lastExperiment.id}`,
      resultArtifact,
    );
    downloadJson(
      `${lastExperiment.id}-go-no-go-from-ratings.json`,
      resultArtifact,
    );
    setEvaluationSummary(
      `Coached wins ${summary.coachedWins} · baseline ${summary.baselineWins} · ties ${summary.ties} · win rate ${(summary.coachedWinRate * 100).toFixed(0)}% · suggestion ${proposal.suggested}`,
    );
    setMessage(proposal.rationale);
  };

  const currentBlindEntry =
    blindReview && blindSchedule
      ? blindSchedule.publicEntries[blindReview.currentIndex]
      : undefined;
  const currentBlindMediaUrl = currentBlindEntry
    ? candidateMediaUrls[currentBlindEntry.playbackAssetId]
    : undefined;

  return (
    <section className="screen">
      {blindReviewVisible && blindReview && currentBlindEntry && (
        <div className="blind-review-overlay" role="dialog" aria-modal="true">
          <div className="blind-review-header">
            <div>
              <p className="eyebrow">Blind presenter review</p>
              <h1>{currentBlindEntry.blindId}</h1>
              <p className="muted">
                Candidate {blindReview.currentIndex + 1} of{" "}
                {blindReview.blindIds.length} · evaluator{" "}
                {blindReview.evaluatorId}
              </p>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => setBlindReviewVisible(false)}
            >
              Exit review
            </button>
          </div>
          <div className="blind-review-grid">
            <div className="panel">
              {currentBlindMediaUrl ? (
                <video
                  key={currentBlindEntry.blindId}
                  className="blind-candidate-video"
                  src={currentBlindMediaUrl}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <p className="notice warning">
                  Verified media is unavailable. Exit and reattach candidates.
                </p>
              )}
              <p className="muted">
                Condition, provider, filename, and repeat status remain hidden
                until all ratings are complete.
              </p>
            </div>
            <div className="panel blind-rubric">
              <h2>Rate this candidate</h2>
              <p className="muted">
                Use one direction throughout: 1 = severe or unusable, 3 =
                acceptable, 5 = excellent or clean.
              </p>
              {evaluationDimensions.map((dimension) => (
                <fieldset key={dimension}>
                  <legend>{dimensionLabel(dimension)}</legend>
                  <div className="blind-score-row">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <label key={score}>
                        <input
                          type="radio"
                          name={`${currentBlindEntry.blindId}-${dimension}`}
                          value={score}
                          checked={blindScores[dimension] === score}
                          onChange={() =>
                            setBlindScores((current) => ({
                              ...current,
                              [dimension]: score,
                            }))
                          }
                        />
                        {score}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <label>
                Preference reason or notable artifact
                <textarea
                  rows={4}
                  value={blindReason}
                  onChange={(event) => setBlindReason(event.target.value)}
                />
              </label>
              {blindReviewError && (
                <p className="notice warning">{blindReviewError}</p>
              )}
              <button
                type="button"
                disabled={!currentBlindMediaUrl}
                onClick={() => void submitBlindRating()}
              >
                {blindReview.currentIndex + 1 === blindReview.blindIds.length
                  ? "Complete blind review"
                  : "Save rating and continue"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="screen-copy">
        <p className="eyebrow">Presenter-twin proof</p>
        <h1>Build the controlled A–D test</h1>
        <p className="lede">
          Select sealed evidence once. The app enforces one script, one real
          voice, equivalent output settings, immutable lineage, and a reviewed
          provider record before producing generation requests.
        </p>
      </div>
      <div className="panel" style={{ marginBottom: 24 }}>
        <h2>Capture checklist (empirical)</h2>
        <ol className="readiness-list">
          {checklist.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>
              <span className="muted"> — {item.detail}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="setup-grid">
        <div className="panel">
          <h2>Controlled sources</h2>
          <div className="train-setup">
            <label>
              A · Uncoached baseline
              <select
                value={uncoachedSessionId}
                onChange={(event) => setUncoachedSessionId(event.target.value)}
              >
                <option value="">Select session</option>
                {completeSessions.map((session) => (
                  <option key={session.manifest.id} value={session.manifest.id}>
                    {session.manifest.id.slice(0, 12)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              B · Coached continuous take
              <select
                value={coachedSessionId}
                onChange={(event) => setCoachedSessionId(event.target.value)}
              >
                <option value="">Select session</option>
                {completeSessions.map((session) => (
                  <option key={session.manifest.id} value={session.manifest.id}>
                    {session.manifest.id.slice(0, 12)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              C · Curated dataset version
              <select
                value={curatedDatasetVersion ?? ""}
                onChange={(event) =>
                  setCuratedDatasetVersion(
                    event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  )
                }
              >
                <option value="">Select version</option>
                {versions.map((version) => (
                  <option key={version.version} value={version.version}>
                    v{version.version} · {version.clipIds.length} clips
                  </option>
                ))}
              </select>
            </label>
            <label>
              D · Real-video reference
              <select
                value={realReferenceSessionId}
                onChange={(event) =>
                  setRealReferenceSessionId(event.target.value)
                }
              >
                <option value="">Select session</option>
                {completeSessions.map((session) => (
                  <option key={session.manifest.id} value={session.manifest.id}>
                    {session.manifest.id.slice(0, 12)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Shared real-voice master
              <select
                value={voiceAssetId}
                onChange={(event) => setVoiceAssetId(event.target.value)}
              >
                <option value="">Select audio master</option>
                {voiceAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.sessionId.slice(0, 8)} · {asset.relativePath}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Matched script
              <textarea
                rows={8}
                value={scriptText}
                onChange={(event) => setScriptText(event.target.value)}
                placeholder="Paste the exact script used by all four conditions."
              />
            </label>
            <p className="muted">
              Script SHA-256: {scriptSha256 || "waiting for script"}
            </p>
          </div>
        </div>
        <div className="panel">
          <h2>Readiness gate</h2>
          <div className="readiness-list">
            {readiness.checks.map((check) => (
              <p className={check.ready ? "ready" : "blocked"} key={check.id}>
                <strong>{check.ready ? "PASS" : "OPEN"}</strong> {check.detail}
              </p>
            ))}
          </div>
          <h2>Provider requirements</h2>
          <textarea
            className="provider-json"
            aria-label="Provider requirements JSON"
            rows={18}
            value={providerJson}
            onChange={(event) => setProviderJson(event.target.value)}
          />
          <div className="button-row">
            <button
              type="button"
              disabled={!readiness.ready}
              onClick={() => void createExperiment()}
            >
              Create experiment manifest
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!lastExperiment || !candidateArchive}
              onClick={() => {
                if (!lastExperiment || !candidateArchive) return;
                const schedule = buildBlindEvaluationSchedule({
                  experimentId: lastExperiment.id,
                  seed: `${lastExperiment.id}:blind`,
                  candidates: phase4CandidatesFromArchive(candidateArchive),
                });
                setBlindSchedule(schedule);
                setPrivateReveal(schedule.privateReveal);
                void store.settings.put(
                  archiveBoundKey(
                    "presenterTwinBlindSchedule",
                    lastExperiment.id,
                    candidateArchive.archiveManifestSha256!,
                  ),
                  schedule,
                );
                downloadJson(
                  `${lastExperiment.id}-blind-public.json`,
                  publicBlindScheduleArtifact(schedule),
                );
                downloadJson(
                  `${lastExperiment.id}-blind-reveal-private.json`,
                  {
                    format: schedule.format,
                    experimentId: schedule.experimentId,
                    privateReveal: schedule.privateReveal,
                  },
                );
                const csv = blankRatingSheetCsv({
                  blindIds: schedule.publicEntries.map((entry) => entry.blindId),
                });
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `${lastExperiment.id}-rating-sheet.csv`;
                anchor.click();
                URL.revokeObjectURL(url);
                setMessage(
                  "Downloaded the candidate-backed public schedule, private reveal, and blank CSV rating sheet. Keep reveal offline.",
                );
              }}
            >
              Export blind schedule + ratings
            </button>
          </div>
          {message && <p className="muted">{message}</p>}
          {evaluationSummary && (
            <p className="ready">
              <strong>Evaluation</strong> {evaluationSummary}
            </p>
          )}

          <h2>After generation (import)</h2>
          <div className="train-setup">
            <label>
              Candidate archive (JSON)
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) =>
                  void importCandidateArchive(event.target.files?.[0])
                }
              />
            </label>
            <label>
              Candidate videos
              <input
                type="file"
                accept="video/*"
                multiple
                disabled={!candidateArchive}
                onChange={(event) =>
                  void attachCandidateMedia(event.target.files)
                }
              />
            </label>
            <p className="muted">
              {Object.keys(candidateMediaUrls).length} of{" "}
              {candidateArchive?.entries.length ?? 0} media files attached and
              hash-verified
            </p>
            <label>
              Private reveal key (JSON)
              <input
                type="file"
                accept="application/json,.json"
                disabled={!candidateArchive}
                onChange={(event) =>
                  void importReveal(event.target.files?.[0])
                }
              />
            </label>
            <label>
              Filled rating sheet (JSON or CSV)
              <input
                type="file"
                accept="application/json,.json,text/csv,.csv"
                disabled={!blindSchedule}
                onChange={(event) =>
                  void importRatings(event.target.files?.[0])
                }
              />
            </label>
          </div>
          <h2>In-app blind review</h2>
          <div className="train-setup">
            <label>
              Evaluator ID
              <input
                value={evaluatorId}
                onChange={(event) => setEvaluatorId(event.target.value)}
                placeholder="evaluator-1"
              />
            </label>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              disabled={
                !blindSchedule ||
                Object.keys(candidateMediaUrls).length !==
                  candidateArchive?.entries.length
              }
              onClick={() => void startBlindReview()}
            >
              Start or resume blind review
            </button>
          </div>
          <h2>Human success gates</h2>
          <div className="train-setup">
            <label>
              Intended-use candidate review
              <select
                value={acceptableCandidate}
                disabled={!candidateArchive}
                onChange={(event) =>
                  setAcceptableCandidate(event.target.value)
                }
              >
                <option value="__unreviewed__">Not reviewed</option>
                <option value="__none__">No acceptable candidate</option>
                {candidateArchive?.entries
                  .filter(
                    (entry) =>
                      entry.durationSec >= 10 && entry.durationSec <= 60,
                  )
                  .map((entry) => (
                    <option key={entry.candidateId} value={entry.candidateId}>
                      Acceptable: {entry.candidateId} ·{" "}
                      {entry.durationSec.toFixed(1)}s
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Provider data-control and rights
              <select
                value={providerDisposition}
                onChange={(event) =>
                  setProviderDisposition(event.target.value)
                }
              >
                <option value="__unreviewed__">Not reviewed</option>
                <option value="acceptable">Acceptable</option>
                <option value="unacceptable">Unacceptable</option>
              </select>
            </label>
            <label className="feature-flag">
              <input
                type="checkbox"
                checked={expertReviewComplete}
                onChange={(event) =>
                  setExpertReviewComplete(event.target.checked)
                }
              />
              Expert frame-by-frame artifact review completed
            </label>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              disabled={
                !lastExperiment ||
                !importedRatings ||
                !blindSchedule ||
                !privateReveal.length
              }
              onClick={() => void computeEvaluation()}
            >
              Score ratings → go/no-go suggestion
            </button>
          </div>

          <h2>Expert artifact checklist</h2>
          <ul className="readiness-list">
            {expertChecklist.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <span className="muted"> — {item.detail}</span>
              </li>
            ))}
          </ul>

          <p className="muted">
            Empirical next: capture matched A–D sealed masters (CaptureCore),
            select a provider, produce candidates, run blind review, then set
            go/no-go. No upload is performed by this screen.
          </p>
        </div>
      </div>
    </section>
  );
}
