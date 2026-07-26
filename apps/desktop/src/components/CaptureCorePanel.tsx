import { useCallback, useEffect, useState } from "react";
import {
  CAPTURE_CORE_DEFAULT_SEGMENT_SEC,
  CAPTURE_CORE_VERTICAL_SLICE_SEC,
  isCaptureCoreVerticalSliceComplete,
  shortSha256,
  type CaptureCoreRunResult,
  type CaptureProfile,
} from "../../../../packages/contracts/src";
import {
  captureCoreBinaryPath,
  captureCoreDryRun,
  captureCoreLiveRecord,
  captureCoreReconcileProfile,
  captureCoreScanOrphans,
  captureCoreSessionsRoot,
  captureCoreStop,
  captureCoreVerticalSlice,
  isCaptureCoreHostAvailable,
  listenCaptureCoreEvents,
  summarizeCaptureCoreEvent,
  type CaptureCoreProtocolEvent,
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
  const [binaryPath, setBinaryPath] = useState<string>();
  const [orphans, setOrphans] = useState<OrphanRow[]>([]);
  const [lastRun, setLastRun] = useState<CaptureCoreRunResult>();
  const [bindNote, setBindNote] = useState<string>();
  const [liveSeconds, setLiveSeconds] = useState(CAPTURE_CORE_VERTICAL_SLICE_SEC);
  const [progress, setProgress] = useState<string>();
  const [liveEvent, setLiveEvent] = useState<CaptureCoreProtocolEvent>();

  const refreshOrphans = useCallback(async () => {
    if (!host) return;
    try {
      const [root, scan, binary] = await Promise.all([
        captureCoreSessionsRoot(),
        captureCoreScanOrphans(),
        captureCoreBinaryPath().catch(() => "not found"),
      ]);
      setSessionsRoot(root);
      setBinaryPath(binary);
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

  useEffect(() => {
    if (!host) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listenCaptureCoreEvents((event) => {
      if (!active) return;
      setLiveEvent(event);
      setProgress(summarizeCaptureCoreEvent(event));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [host]);

  const runWith = async (
    kind: "dry" | "live" | "slice",
    action: () => Promise<CaptureCoreRunResult>,
  ) => {
    if (!profile) {
      setError("Choose a capture profile on Setup first.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setBindNote(undefined);
    setProgress(
      kind === "dry"
        ? "Starting dry-run…"
        : kind === "slice"
          ? "Starting Stage 4 vertical slice…"
          : "Starting live record…",
    );
    setLiveEvent(undefined);
    onReleaseMedia();
    try {
      const result = await action();
      setLastRun(result);
      const sealed = isCaptureCoreVerticalSliceComplete(result);
      setProgress(
        result.exitCode === 0
          ? sealed
            ? result.dryRun
              ? "Vertical slice sealed (dry-run masters)"
              : "Vertical slice sealed (live masters)"
            : "Finished but seal incomplete"
          : `Finished with exit ${result.exitCode}`,
      );
      void logEvent(
        kind === "dry"
          ? "capture_core_dry_run_complete"
          : kind === "slice"
            ? "capture_core_vertical_slice_complete"
            : "capture_core_live_complete",
        {
          fields: {
            exitCode: result.exitCode,
            segmentCount: result.segmentHashes.length,
            sessionRoot: result.sessionRoot,
            dryRun: result.dryRun,
            verticalSliceComplete: sealed,
            sealPath: result.sealPath ?? null,
          },
        },
      );
      await refreshOrphans();
      if (result.exitCode !== 0) {
        setError(`CaptureCore exited with code ${result.exitCode}`);
      } else if (!sealed) {
        setError("Recording finished but Rust session seal or segment hashes are missing.");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setProgress(undefined);
      void logEvent(
        kind === "dry"
          ? "capture_core_dry_run_failed"
          : kind === "slice"
            ? "capture_core_vertical_slice_failed"
            : "capture_core_live_failed",
        {
          level: "error",
          fields: { message },
        },
      );
    } finally {
      setBusy(false);
    }
  };

  const runVerticalSlice = () =>
    void runWith("slice", () => captureCoreVerticalSlice({ profile: profile! }));

  const runDryRun = () =>
    void runWith("dry", () =>
      captureCoreDryRun({
        profile: profile!,
        maxDurationSec: 1,
        segmentDurationSec: 0.4,
      }),
    );

  const runLive = () => {
    if (!profile?.deviceBindings?.avFoundationCameraId) {
      setError("Bind an AVFoundation camera first (Match devices by name), or set bindings on Setup.");
      return;
    }
    const seconds = Math.min(120, Math.max(5, liveSeconds));
    void runWith("live", () =>
      captureCoreLiveRecord({
        profile: profile!,
        maxDurationSec: seconds,
        segmentDurationSec: Math.min(CAPTURE_CORE_DEFAULT_SEGMENT_SEC, seconds),
      }),
    );
  };

  const requestStop = async () => {
    try {
      const result = await captureCoreStop();
      setProgress(result.sent ? "Stop requested…" : "No active recording to stop");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
  const sliceComplete = lastRun ? isCaptureCoreVerticalSliceComplete(lastRun) : false;
  const payload = liveEvent?.payload;

  return (
    <section className="screen dataset-screen">
      <div className="screen-copy">
        <p className="eyebrow">Dataset · Stage 4</p>
        <h1>CaptureCore masters</h1>
        <p className="lede">
          One primary action: run the vertical slice. The practice camera is released first;
          closed segments are SHA-256 sealed in Rust under Application Support.
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
          <h2>Vertical slice</h2>
          <dl className="dataset-facts">
            <div>
              <dt>Profile</dt>
              <dd>{profile?.name ?? "None selected"}</dd>
            </div>
            <div>
              <dt>AV camera</dt>
              <dd className={avReady ? "" : "muted"}>
                {bindings?.avFoundationCameraId
                  ? "Bound · live 30s slice available"
                  : "Not bound · slice uses dry-run masters"}
              </dd>
            </div>
            <div>
              <dt>Live duration</dt>
              <dd>{CAPTURE_CORE_VERTICAL_SLICE_SEC}s (charter) · {CAPTURE_CORE_DEFAULT_SEGMENT_SEC}s segments</dd>
            </div>
            <div>
              <dt>Incomplete sessions</dt>
              <dd>{orphans.length}</dd>
            </div>
          </dl>

          <div className="dataset-actions">
            <button disabled={!host || busy || !profile} onClick={runVerticalSlice}>
              {busy
                ? "Running…"
                : avReady
                  ? `Run ${CAPTURE_CORE_VERTICAL_SLICE_SEC}s live slice`
                  : "Run vertical slice (dry-run)"}
            </button>
            <button
              className="stop"
              disabled={!host || !busy}
              onClick={() => void requestStop()}
            >
              Stop
            </button>
          </div>

          <details className="dataset-details">
            <summary>More recording options</summary>
            <label className="dataset-duration">
              Custom live duration (seconds)
              <input
                type="number"
                min={5}
                max={120}
                step={5}
                value={liveSeconds}
                disabled={busy}
                onChange={(event) =>
                  setLiveSeconds(Number(event.target.value) || CAPTURE_CORE_VERTICAL_SLICE_SEC)
                }
              />
            </label>
            <div className="dataset-actions">
              <button
                className="secondary"
                disabled={!host || busy || !profile || !avReady}
                onClick={runLive}
              >
                Live {Math.min(120, Math.max(5, liveSeconds))}s
              </button>
              <button
                className="secondary"
                disabled={!host || busy || !profile}
                onClick={runDryRun}
              >
                Dry-run only
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
          </details>

          {(busy || progress) && (
            <div className={`dataset-progress ${busy ? "live" : ""}`} role="status" aria-live="polite">
              <strong>{busy ? "In progress" : "Last status"}</strong>
              <span>{progress ?? "…"}</span>
              {payload && typeof payload.videoFrames === "number" && (
                <span className="muted">
                  frames {payload.videoFrames as number}
                  {typeof payload.segmentIndex === "number"
                    ? ` · segment ${payload.segmentIndex as number}`
                    : ""}
                </span>
              )}
            </div>
          )}

          {bindNote && <p className="format">{bindNote}</p>}
          {error && (
            <div className="notice warning" role="alert">
              <strong>Could not complete</strong>
              <span>{error}</span>
            </div>
          )}
          {sliceComplete && !busy && lastRun && (
            <div className="notice success" role="status">
              <strong>Stage 4 slice complete</strong>
              <span>
                {lastRun.segmentHashes.length} hashed file
                {lastRun.segmentHashes.length === 1 ? "" : "s"} · Rust seal written
                {lastRun.dryRun ? " · dry-run masters" : " · live masters"}
              </span>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Last seal</h2>
          {!lastRun && (
            <p className="muted dataset-empty">
              Run the vertical slice to write masters and see SHA-256 digests.
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
            <p className="muted">Sessions root: {sessionsRoot ?? "—"}</p>
            <p className="muted">CaptureCore binary: {binaryPath ?? "—"}</p>
            {lastRun && (
              <p className="muted">
                Session: {lastRun.sessionRoot}
                {lastRun.sealPath ? " · seal written" : " · no seal"}
                {lastRun.dryRun ? " · dry-run" : " · live"}
                {sliceComplete ? " · vertical slice OK" : ""}
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
