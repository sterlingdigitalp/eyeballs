import { useCallback, useEffect, useState } from "react";
import {
  shortSha256,
  type CaptureCoreRunResult,
  type CaptureProfile,
} from "../../../../packages/contracts/src";
import {
  captureCoreDryRun,
  captureCoreReconcileProfile,
  captureCoreScanOrphans,
  captureCoreSessionsRoot,
  isCaptureCoreHostAvailable,
} from "../lib/capture-core";
import { logEvent } from "../lib/logging";

type Props = {
  profile?: CaptureProfile;
  /** Release webview camera/mic so Dataset mode does not dual-own devices. */
  onReleaseMedia: () => void;
  onProfilePatched: (profile: CaptureProfile) => Promise<void> | void;
};

type OrphanRow = {
  sessionId?: string;
  sessionRoot?: string;
  segmentCount?: number;
  status?: string;
};

export function CaptureCorePanel({ profile, onReleaseMedia, onProfilePatched }: Props) {
  const host = isCaptureCoreHostAvailable();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sessionsRoot, setSessionsRoot] = useState<string>();
  const [orphans, setOrphans] = useState<OrphanRow[]>([]);
  const [lastRun, setLastRun] = useState<CaptureCoreRunResult>();
  const [bindNote, setBindNote] = useState<string>();

  const refreshOrphans = useCallback(async () => {
    if (!host) return;
    try {
      const [root, scan] = await Promise.all([
        captureCoreSessionsRoot(),
        captureCoreScanOrphans(),
      ]);
      setSessionsRoot(root);
      setOrphans(
        (scan.orphans as OrphanRow[]).map((row) => ({
          sessionId: typeof row.sessionId === "string" ? row.sessionId : undefined,
          sessionRoot: typeof row.sessionRoot === "string" ? row.sessionRoot : undefined,
          segmentCount: typeof row.segmentCount === "number" ? row.segmentCount : undefined,
          status: typeof row.status === "string" ? row.status : undefined,
        })),
      );
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host]);

  useEffect(() => {
    void refreshOrphans();
  }, [refreshOrphans]);

  const runDryRun = async () => {
    if (!profile) {
      setError("Choose a capture profile on Setup first.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setBindNote(undefined);
    onReleaseMedia();
    try {
      const result = await captureCoreDryRun({ profile, maxDurationSec: 1 });
      setLastRun(result);
      void logEvent("capture_core_dry_run_complete", {
        fields: {
          exitCode: result.exitCode,
          segmentCount: result.segmentHashes.length,
          sessionRoot: result.sessionRoot,
        },
      });
      await refreshOrphans();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      void logEvent("capture_core_dry_run_failed", {
        level: "error",
        fields: { message },
      });
    } finally {
      setBusy(false);
    }
  };

  const bindDevices = async () => {
    if (!profile) {
      setError("Choose a capture profile on Setup first.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const next = await captureCoreReconcileProfile(profile);
      await onProfilePatched(next);
      const cam = next.deviceBindings?.avFoundationCameraId;
      const mic = next.deviceBindings?.avFoundationMicrophoneId;
      setBindNote(
        cam || mic
          ? `Bound camera ${cam ? "✓" : "—"} · mic ${mic ? "✓" : "—"}`
          : "No unique name matches — check labels or set IDs after list-devices.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const bindings = profile?.deviceBindings;
  const avReady = Boolean(bindings?.avFoundationCameraId);

  return (
    <section className="screen dataset-screen">
      <div className="screen-copy">
        <p className="eyebrow">Dataset</p>
        <h1>CaptureCore masters</h1>
        <p className="lede">
          Software path first: dry-run writes sealed segment placeholders under Application
          Support, hashed in Rust. Live camera stays off until Stage 0 runs from a TCC-capable
          host.
        </p>
      </div>

      {!host && (
        <div className="notice warning" role="status">
          <strong>Desktop shell required</strong>
          <span>Open the Tauri app to prepare sessions and run CaptureCore.</span>
        </div>
      )}

      <div className="dataset-grid">
        <div className="panel">
          <h2>Software dry-run</h2>
          <p className="muted">
            Uses the active profile. Releases the practice camera first so Dataset never shares
            the device with CaptureCore.
          </p>
          <dl className="dataset-facts">
            <div>
              <dt>Profile</dt>
              <dd>{profile?.name ?? "None selected"}</dd>
            </div>
            <div>
              <dt>AV camera</dt>
              <dd className={avReady ? "" : "muted"}>
                {bindings?.avFoundationCameraId
                  ? "Bound"
                  : "Not bound (dry-run still works)"}
              </dd>
            </div>
            <div>
              <dt>Incomplete sessions</dt>
              <dd>{orphans.length}</dd>
            </div>
          </dl>

          <div className="dataset-actions">
            <button disabled={!host || busy || !profile} onClick={() => void runDryRun()}>
              {busy ? "Working…" : "Run dry-run record"}
            </button>
            <button
              className="secondary"
              disabled={!host || busy || !profile}
              onClick={() => void bindDevices()}
            >
              Match devices by name
            </button>
            <button
              className="secondary"
              disabled={!host || busy}
              onClick={() => void refreshOrphans()}
            >
              Scan orphans
            </button>
          </div>
          {bindNote && <p className="format">{bindNote}</p>}
          {error && (
            <div className="notice warning" role="alert">
              <strong>Could not complete</strong>
              <span>{error}</span>
            </div>
          )}
          {lastRun && lastRun.exitCode === 0 && (
            <div className="notice success" role="status">
              <strong>Dry-run sealed</strong>
              <span>
                {lastRun.segmentHashes.length} segment file
                {lastRun.segmentHashes.length === 1 ? "" : "s"} · exit {lastRun.exitCode}
              </span>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Last seal</h2>
          {!lastRun && (
            <p className="muted dataset-empty">
              Run a dry-run to write masters, then see SHA-256 digests here.
            </p>
          )}
          {lastRun && (
            <ul className="dataset-hash-list">
              {lastRun.segmentHashes.map((segment) => {
                const name = segment.path.split("/").pop() ?? segment.path;
                return (
                  <li key={segment.path}>
                    <strong>{name}</strong>
                    <span className="tabular">{shortSha256(segment.sha256)}</span>
                    <small className="muted">{segment.byteLength} bytes</small>
                  </li>
                );
              })}
            </ul>
          )}
          <details className="dataset-details">
            <summary>Developer details</summary>
            <p className="muted">
              Sessions root: {sessionsRoot ?? "—"}
            </p>
            {lastRun && (
              <p className="muted">
                Session: {lastRun.sessionRoot}
                {lastRun.sealPath ? ` · seal written` : ""}
              </p>
            )}
            {orphans.length > 0 && (
              <ul className="dataset-orphan-list">
                {orphans.map((orphan) => (
                  <li key={orphan.sessionRoot ?? orphan.sessionId}>
                    {orphan.sessionId ?? "session"} · {orphan.segmentCount ?? 0} segments ·{" "}
                    {orphan.status ?? "incomplete"}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      </div>
    </section>
  );
}
