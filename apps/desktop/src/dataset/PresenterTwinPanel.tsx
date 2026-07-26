import { useEffect, useMemo, useState } from "react";
import type {
  ClipCandidate,
  RecordingAsset,
} from "../../../../packages/contracts/src";
import {
  attachCandidateArchiveToExperimentNotes,
  auditPresenterTwinReadiness,
  buildBlindEvaluationSchedule,
  createPhase4GoNoGoDraft,
  createPresenterTwinExperiment,
  emptyRatingSheet,
  expertArtifactChecklist,
  measureEvaluatorConsistency,
  parseRatingSheet,
  parseRatingSheetCsv,
  phase4CandidateArchiveSchema,
  phase4CaptureChecklist,
  proposePhase4Decision,
  publicBlindScheduleArtifact,
  phase4ProviderRequirementsSchema,
  ratingSheetToCsv,
  sha256Hex,
  summarizeCoachedVsBaseline,
  type BlindEvaluationSchedule,
  type DatasetVersionManifest,
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
  const [importedRatings, setImportedRatings] = useState<Phase4RatingSheet>();
  const [evaluationSummary, setEvaluationSummary] = useState<string>();

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
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as {
        privateReveal?: BlindEvaluationSchedule["privateReveal"];
      };
      if (!raw.privateReveal?.length) {
        throw new Error("File missing privateReveal array");
      }
      setPrivateReveal(raw.privateReveal);
      setMessage(
        `Loaded private reveal with ${raw.privateReveal.length} entries — keep offline.`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importRatings = async (file: File | undefined) => {
    if (!file || !lastExperiment) return;
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
      setImportedRatings(sheet);
      await store.settings.put(
        `presenterTwinRatings:${lastExperiment.id}`,
        sheet,
      );
      setMessage(
        `Imported ${sheet.ratings.length} ratings for ${lastExperiment.id.slice(0, 18)}…`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importCandidateArchive = async (file: File | undefined) => {
    if (!file || !lastExperiment) return;
    try {
      const archive = phase4CandidateArchiveSchema.parse(
        JSON.parse(await file.text()),
      );
      const note = attachCandidateArchiveToExperimentNotes({
        experiment: lastExperiment,
        archive,
      });
      await store.settings.put(
        `presenterTwinCandidates:${lastExperiment.id}`,
        archive,
      );
      setMessage(
        `Candidate archive attached · ${note.candidateCount} entries · hash ${note.archiveManifestSha256?.slice(0, 12) ?? "n/a"}…`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const computeEvaluation = () => {
    if (!lastExperiment) {
      setMessage("Create or load an experiment first.");
      return;
    }
    if (!importedRatings?.ratings.length) {
      setMessage("Import a filled rating sheet first.");
      return;
    }
    if (!privateReveal.length) {
      setMessage("Import the private reveal key first.");
      return;
    }
    const schedule: BlindEvaluationSchedule = {
      format: "presenter-twin-blind-schedule/1.0.0",
      experimentId: lastExperiment.id,
      publicEntries: privateReveal.map((reveal) => ({
        blindId: reveal.blindId,
        playbackAssetId:
          lastExperiment.sourcePackages.find((source) =>
            reveal.candidateId.startsWith(source.id),
          )?.assetIds[0] ?? reveal.candidateId,
      })),
      privateReveal,
    };
    type RatingScores = Parameters<
      typeof summarizeCoachedVsBaseline
    >[0]["ratings"][number]["scores"];
    const summary = summarizeCoachedVsBaseline({
      schedule,
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
      hasAcceptableCandidate: true,
      providerAcceptable: true,
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
        "Human must confirm final decision and usable-candidate claim",
      ],
    });
    downloadJson(`${lastExperiment.id}-go-no-go-from-ratings.json`, {
      ...report,
      softwareSuggestion: proposal,
      evaluatorConsistency: consistency,
    });
    setEvaluationSummary(
      `Coached wins ${summary.coachedWins} · baseline ${summary.baselineWins} · ties ${summary.ties} · win rate ${(summary.coachedWinRate * 100).toFixed(0)}% · suggestion ${proposal.suggested}`,
    );
    setMessage(proposal.rationale);
  };

  return (
    <section className="screen">
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
              disabled={!lastExperiment}
              onClick={() => {
                if (!lastExperiment) return;
                const schedule = buildBlindEvaluationSchedule({
                  experimentId: lastExperiment.id,
                  seed: `${lastExperiment.id}:blind`,
                  candidates: lastExperiment.sourcePackages.map((source) => ({
                    id: `${source.id}-candidate-0`,
                    condition: source.condition,
                    playbackAssetId: source.assetIds[0] ?? source.id,
                    providerId: lastExperiment.provider.providerId,
                    providerVersion: lastExperiment.provider.providerVersion,
                  })),
                });
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
                const sheet = emptyRatingSheet({
                  experimentId: lastExperiment.id,
                  blindIds: schedule.publicEntries.map((entry) => entry.blindId),
                });
                downloadJson(`${lastExperiment.id}-rating-sheet.json`, sheet);
                const csv = ratingSheetToCsv(sheet);
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `${lastExperiment.id}-rating-sheet.csv`;
                anchor.click();
                URL.revokeObjectURL(url);
                setMessage(
                  "Downloaded public blind schedule, private reveal, and rating sheet (JSON+CSV). Keep reveal offline.",
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
              Private reveal key (JSON)
              <input
                type="file"
                accept="application/json,.json"
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
                onChange={(event) =>
                  void importRatings(event.target.files?.[0])
                }
              />
            </label>
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
          </div>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              disabled={!lastExperiment || !importedRatings || !privateReveal.length}
              onClick={computeEvaluation}
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
