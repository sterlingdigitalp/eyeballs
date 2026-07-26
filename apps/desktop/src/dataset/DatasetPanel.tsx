import { useEffect, useMemo, useState } from "react";
import type {
  ClipCandidate,
  ConsentRecord,
  RecordingAsset,
} from "../../../../packages/contracts/src";
import {
  buildCoverageReport,
  buildExportPackage,
  createDatasetVersion,
  createVersionExcludingRevoked,
  downloadExportPackage,
  findNearDuplicates,
  isSha256Hex,
  verifyExportPackage,
  type DatasetVersionManifest,
} from "../../../../packages/dataset/src";
import { store, type StoredSession } from "../lib/store";

export function DatasetPanel({
  sessions,
  consents,
  clips,
  assets,
}: {
  sessions: StoredSession[];
  consents: ConsentRecord[];
  clips: ClipCandidate[];
  assets: RecordingAsset[];
}) {
  const [versions, setVersions] = useState<DatasetVersionManifest[]>([]);
  const [message, setMessage] = useState<string>();
  const [exportOk, setExportOk] = useState<boolean>();

  useEffect(() => {
    void store.datasetVersions.all().then((raw) => {
      setVersions(raw as DatasetVersionManifest[]);
    });
  }, []);

  const coverage = useMemo(
    () =>
      buildCoverageReport(
        clips
          .filter((clip) => clip.label === "excellent" || clip.label === "usable")
          .map((clip) => {
            const session = sessions.find((entry) => entry.manifest.id === clip.sessionId);
            const tags = [
              session?.manifest.dataset?.outfitLabel ?? "outfit_unknown",
              session?.manifest.dataset?.backgroundLabel ?? "bg_unknown",
              session?.manifest.coaching?.drillId ?? "drill_unknown",
              clip.proposedBy === "auto" ? "auto_proposed" : "human_range",
            ];
            return { clip, tags };
          }),
      ),
    [clips, sessions],
  );

  const duplicates = useMemo(
    () =>
      findNearDuplicates(
        clips.map((clip) => {
          const session = sessions.find((entry) => entry.manifest.id === clip.sessionId);
          const look = [
            session?.manifest.dataset?.outfitLabel ?? "outfit",
            session?.manifest.dataset?.backgroundLabel ?? "bg",
          ].join("|");
          return {
            clip,
            transcriptText: `${clip.sessionId} ${clip.startUs}-${clip.endUs} ${clip.reasonTags.join(" ")}`,
            lookBackgroundKey: look,
          };
        }),
      ),
    [clips, sessions],
  );

  return (
    <section className="screen" data-dataset-export="true">
      <div className="screen-copy">
        <p className="eyebrow">Dataset</p>
        <h1>Versions and export</h1>
        <p className="lede">
          Immutable manifests with lineage. Export downloads a JSON archive with real SHA-256 file
          digests. Coaching works without dataset mode.
        </p>
      </div>
      <div className="panel">
        <h2>Coverage</h2>
        <p className="muted">Missing: {coverage.missing.slice(0, 8).join(", ") || "none"}</p>
        <p className="muted">
          Overrepresented: {coverage.overrepresented.slice(0, 8).join(", ") || "none"}
        </p>
        <p className="muted">
          Fragile (single source): {coverage.fragile.slice(0, 8).join(", ") || "none"}
        </p>
      </div>
      <div className="panel">
        <h2>Near-duplicates (non-biometric)</h2>
        {!duplicates.length && <p className="muted">No pairs flagged.</p>}
        {duplicates.slice(0, 5).map((pair) => (
          <p key={`${pair.leftId}-${pair.rightId}`} className="muted">
            {pair.leftId.slice(0, 8)} ↔ {pair.rightId.slice(0, 8)} · {pair.reasons.join("; ")}
          </p>
        ))}
      </div>
      <div className="button-row">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              try {
                const version = await createDatasetVersion({
                  datasetId: "local-presenter",
                  version: (versions.at(-1)?.version ?? 0) + 1,
                  createdAt: new Date().toISOString(),
                  sessions: sessions.map((session) => session.manifest),
                  consents,
                  clips,
                  assets,
                });
                const next = [...versions, version];
                setVersions(next);
                await store.datasetVersions.putAll(next);
                setMessage(
                  `Created dataset v${version.version} (${version.clipIds.length} clips) · sha ${version.manifestSha256.slice(0, 12)}…`,
                );
              } catch (cause) {
                setMessage(cause instanceof Error ? cause.message : String(cause));
              }
            })();
          }}
        >
          Create dataset version
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            void (async () => {
              const prior = versions.at(-1);
              if (!prior) {
                setMessage("Create a version first");
                return;
              }
              try {
                const revokedIds = consents
                  .filter((consent) => consent.revokedAt)
                  .map((consent) => consent.id);
                const { next } = await createVersionExcludingRevoked(prior, {
                  createdAt: new Date().toISOString(),
                  revokedConsentIds: revokedIds,
                  sessions: sessions.map((session) => session.manifest),
                  consents: consents.filter((consent) => !consent.revokedAt),
                  clips,
                  assets,
                });
                const list = [...versions, next];
                setVersions(list);
                await store.datasetVersions.putAll(list);
                setMessage(`Revoke path created v${next.version}`);
              } catch (cause) {
                setMessage(cause instanceof Error ? cause.message : String(cause));
              }
            })();
          }}
        >
          New version excluding revoked
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            void (async () => {
              const prior = versions.at(-1);
              if (!prior) {
                setMessage("Create a version first");
                return;
              }
              const fileContents = {
                "manifest.json": new TextEncoder().encode(JSON.stringify(prior, null, 2)),
                "README.md": new TextEncoder().encode(
                  `# Presenter dataset v${prior.version}\n\nClips: ${prior.clipIds.length}\n`,
                ),
                "coverage_notes.json": new TextEncoder().encode(
                  JSON.stringify({ sourceSessionIds: prior.sourceSessionIds }, null, 2),
                ),
              };
              const pkg = await buildExportPackage(prior, fileContents);
              const ok = await verifyExportPackage(pkg, fileContents);
              setExportOk(ok);
              if (ok) {
                await downloadExportPackage(pkg, fileContents);
                setMessage(
                  `Downloaded export · ${pkg.files.length} files · package sha256 ${isSha256Hex(pkg.packageSha256) ? pkg.packageSha256.slice(0, 16) : "?"}…`,
                );
              } else {
                setMessage("Export package hash verification failed — download skipped");
              }
            })();
          }}
        >
          Build, verify (SHA-256), download
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
      {exportOk !== undefined && (
        <p className={exportOk ? "pass" : "fail"}>export verify: {String(exportOk)}</p>
      )}
      <div className="panel">
        <h2>Versions (persisted)</h2>
        {versions.map((version) => (
          <p key={`${version.id}-${version.version}`} className="muted">
            v{version.version} · {version.clipIds.length} clips · sha{" "}
            {version.manifestSha256.slice(0, 12)}…
          </p>
        ))}
      </div>
    </section>
  );
}
