import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClipCandidate,
  ConsentRecord,
} from "../../../../packages/contracts/src";
import {
  allClipLabels,
  applyCurationKey,
  assertCanPromoteToDataset,
  createHumanClip,
  curationReasonTags,
  detectSpeechStructure,
  scoreTechnicalQuality,
  toggleClipReasonTag,
  type CurationKeyAction,
} from "../../../../packages/dataset/src";
import { store, type StoredSession } from "../lib/store";

const KEY_MAP: Record<string, CurationKeyAction> = {
  "1": "label_excellent",
  "2": "label_usable",
  "3": "label_coaching_only",
  "4": "label_rejected",
  "5": "label_delete",
  j: "nudge_start_left",
  l: "nudge_start_right",
  u: "nudge_end_left",
  o: "nudge_end_right",
};

export function CuratePanel({
  sessions,
  consents,
  clips,
  onClipsChange,
}: {
  sessions: StoredSession[];
  consents: ConsentRecord[];
  clips: ClipCandidate[];
  onClipsChange: (next: ClipCandidate[]) => void;
}) {
  const coached = sessions.filter((session) => session.manifest.status === "complete");
  const [sessionId, setSessionId] = useState(coached[0]?.manifest.id ?? "");
  const [selectedId, setSelectedId] = useState<string | undefined>(
    clips[0]?.id,
  );
  const [rangeStartSec, setRangeStartSec] = useState("0");
  const [rangeEndSec, setRangeEndSec] = useState("3");
  const [rangeError, setRangeError] = useState<string>();
  const [mediaUrl, setMediaUrl] = useState<string>();
  const playerRef = useRef<HTMLVideoElement>(null);

  const sessionClips = useMemo(
    () => clips.filter((clip) => clip.sessionId === sessionId),
    [clips, sessionId],
  );
  const selected =
    sessionClips.find((clip) => clip.id === selectedId) ?? sessionClips[0];
  const selectedSession = sessions.find(
    (session) => session.manifest.id === selected?.sessionId,
  );
  useEffect(() => {
    if (!selectedSession?.media) {
      setMediaUrl(undefined);
      return;
    }
    const nextUrl = URL.createObjectURL(selectedSession.media);
    setMediaUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [selectedSession?.media]);
  useEffect(() => {
    if (playerRef.current && selected) {
      playerRef.current.currentTime = Math.max(
        0,
        selected.startUs / 1_000_000 - 3,
      );
    }
  }, [mediaUrl, selected]);
  const promotionStatus = useMemo(() => {
    if (!selectedSession) return "No source session is selected.";
    try {
      assertCanPromoteToDataset({
        session: selectedSession.manifest,
        consents,
      });
      return "Dataset promotion consent is active.";
    } catch (cause) {
      return cause instanceof Error
        ? `Not promotion-ready: ${cause.message}`
        : "Not promotion-ready.";
    }
  }, [consents, selectedSession]);
  const selectedQuality = useMemo(() => {
    if (!selected || !selectedSession) return undefined;
    const originUs =
      selectedSession.manifest.media?.monotonicStartUs ??
      selectedSession.manifest.monotonicStartUs;
    const absoluteStartUs = originUs + selected.startUs;
    const absoluteEndUs = originUs + selected.endUs;
    const predictions = selectedSession.predictions.filter(
      (prediction) =>
        prediction.timestampUs >= absoluteStartUs &&
        prediction.timestampUs <= absoluteEndUs,
    );
    const features = selectedSession.features.filter(
      (feature) =>
        feature.timestampUs >= absoluteStartUs &&
        feature.timestampUs <= absoluteEndUs,
    );
    const speakingWindows = (selectedSession.speakingWindows ?? [])
      .map((window) =>
        window.startUs >= originUs
          ? window
          : {
              startUs: originUs + window.startUs,
              endUs: originUs + window.endUs,
            },
      )
      .filter(
        (window) =>
          window.startUs < absoluteEndUs &&
          window.endUs > absoluteStartUs,
      );
    const transcript =
      selectedSession.correctedTranscript ?? selectedSession.transcript;
    const speechStructureEvents = transcript
      ? detectSpeechStructure(
          selectedSession.manifest.id,
          transcript.words,
          speakingWindows.map((window) => ({
            startUs: Math.max(0, window.startUs - originUs),
            endUs: Math.max(0, window.endUs - originUs),
          })),
        ).events.filter(
          (event) =>
            event.startUs < selected.endUs && event.endUs > selected.startUs,
        )
      : undefined;
    return scoreTechnicalQuality({
      predictions,
      features,
      speakingWindows,
      droppedFrameCount: selectedSession.manifest.droppedFrameCount,
      totalFrames: selectedSession.manifest.frameCount,
      blinkFrameCount: features.length
        ? features.filter((feature) => feature.blink).length
        : undefined,
      syncConfidence: selectedSession.manifest.dataset?.avTiming?.syncConfidence,
      speechStructureEvents,
    });
  }, [selected, selectedSession]);

  const persist = async (next: ClipCandidate[]) => {
    await store.clips.putAll(next);
    onClipsChange(next);
  };

  return (
    <section
      className="screen"
      data-dataset-curate="true"
      onKeyDown={(event) => {
        if (!selected) return;
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement ||
          event.target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        const action = KEY_MAP[event.key];
        if (!action) return;
        event.preventDefault();
        const updated = applyCurationKey(selected, action);
        void persist(clips.map((clip) => (clip.id === updated.id ? updated : clip)));
        setSelectedId(updated.id);
      }}
      tabIndex={0}
    >
      <div className="screen-copy">
        <p className="eyebrow">Curate</p>
        <h1>Human clip labels</h1>
        <p className="lede">
          Auto proposals appear after dataset-intent sessions. Labels:{" "}
          {allClipLabels().join(", ")}. Keys 1–5 label; j/l nudge start; u/o nudge end. Clips
          persist locally.
        </p>
      </div>
      <div className="panel">
        <label>
          Session
          <select
            value={sessionId}
            onChange={(event) => {
              const nextSessionId = event.target.value;
              setSessionId(nextSessionId);
              setSelectedId(
                clips.find((clip) => clip.sessionId === nextSessionId)?.id,
              );
            }}
          >
            {coached.map((session) => (
              <option key={session.manifest.id} value={session.manifest.id}>
                {session.manifest.id.slice(0, 8)} ·{" "}
                {session.manifest.coaching?.drillId ?? "session"} ·{" "}
                {session.manifest.dataset?.intent ?? "no-dataset"}
              </option>
            ))}
          </select>
        </label>
        <div className="button-row">
          <label>
            Start (s)
            <input
              value={rangeStartSec}
              onChange={(event) => setRangeStartSec(event.target.value)}
            />
          </label>
          <label>
            End (s)
            <input value={rangeEndSec} onChange={(event) => setRangeEndSec(event.target.value)} />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (!sessionId) return;
              const startSeconds = Number(rangeStartSec);
              const endSeconds = Number(rangeEndSec);
              if (
                !Number.isFinite(startSeconds) ||
                !Number.isFinite(endSeconds) ||
                startSeconds < 0 ||
                endSeconds <= startSeconds
              ) {
                setRangeError(
                  "Enter finite times with the end after the non-negative start.",
                );
                return;
              }
              const source = sessions.find(
                (session) => session.manifest.id === sessionId,
              );
              const durationSeconds =
                (source?.manifest.media?.durationUs ?? 0) / 1_000_000;
              if (durationSeconds > 0 && endSeconds > durationSeconds) {
                setRangeError(
                  `The range must end within ${durationSeconds.toFixed(2)} seconds.`,
                );
                return;
              }
              const startUs = Math.round(startSeconds * 1_000_000);
              const endUs = Math.round(endSeconds * 1_000_000);
              const clip = createHumanClip(sessionId, startUs, endUs);
              setRangeError(undefined);
              void persist([...clips, clip]);
              setSelectedId(clip.id);
            }}
          >
            Add range
          </button>
        </div>
        {rangeError && <p className="tracking-warning">{rangeError}</p>}
      </div>
      <div className="panel">
        {!sessionClips.length && (
          <p className="muted">
            No clips for this session. Complete a dataset-intent train session to auto-propose, or
            add a range.
          </p>
        )}
        {sessionClips.map((clip) => (
          <button
            key={clip.id}
            type="button"
            className={`profile-card ${selected?.id === clip.id ? "selected" : ""}`}
            onClick={() => setSelectedId(clip.id)}
          >
            <strong>
              {(clip.startUs / 1e6).toFixed(2)}s–{(clip.endUs / 1e6).toFixed(2)}s
            </strong>
            <small>
              {clip.label ?? "unlabeled"} · {clip.proposedBy} ·{" "}
              {clip.reasonTags.slice(0, 2).join(", ")}
            </small>
          </button>
        ))}
      </div>
      {selected && (
        <div className="panel">
          <h2>Selected clip evidence</h2>
          <p className={promotionStatus.startsWith("Dataset") ? "pass" : "muted"}>
            {promotionStatus}
          </p>
          {selectedQuality && (
            <>
              <div className="metrics-grid">
                <div>
                  <strong>
                    {Math.round(
                      selectedQuality.video.faceDetectedRatio * 100,
                    )}
                    %
                  </strong>
                  <span>Face detected</span>
                </div>
                <div>
                  <strong>
                    {Math.round(
                      selectedQuality.performance.contactDuringSpeaking * 100,
                    )}
                    %
                  </strong>
                  <span>Contact while speaking</span>
                </div>
                <div>
                  <strong>
                    {(
                      selectedQuality.video.droppedFrameRatio * 100
                    ).toFixed(2)}
                    %
                  </strong>
                  <span>Dropped frames (session)</span>
                </div>
                <div>
                  <strong>
                    {Math.round(
                      selectedQuality.performance.completeUtteranceProxy * 100,
                    )}
                    %
                  </strong>
                  <span>Complete utterance proxy</span>
                </div>
              </div>
              <p className="muted">
                {selectedQuality.scoringVersion} · recommendation only
                {selectedQuality.warnings.length
                  ? ` · unavailable: ${selectedQuality.warnings
                      .map((warning) => warning.replace("_unmeasured", ""))
                      .join(", ")}`
                  : ""}
              </p>
            </>
          )}
          {mediaUrl ? (
            <>
              <video ref={playerRef} src={mediaUrl} controls playsInline />
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (playerRef.current) {
                      playerRef.current.currentTime = Math.max(
                        0,
                        selected.startUs / 1_000_000 - 3,
                      );
                    }
                  }}
                >
                  Play 3s context
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (playerRef.current) {
                      playerRef.current.currentTime =
                        selected.startUs / 1_000_000;
                    }
                  }}
                >
                  Jump to in point
                </button>
              </div>
            </>
          ) : (
            <p className="muted">
              Browser review media is unavailable for this session. Native
              master/proxy playback will attach here when the file-based worker
              path is integrated.
            </p>
          )}
          <div className="button-row">
            {allClipLabels().map((label) => (
              <button
                key={label}
                type="button"
                className="secondary"
                onClick={() => {
                  const updated = applyCurationKey(
                    selected,
                    `label_${label}` as CurationKeyAction,
                  );
                  void persist(
                    clips.map((clip) =>
                      clip.id === updated.id ? updated : clip,
                    ),
                  );
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <fieldset>
            <legend>Reason tags</legend>
            {curationReasonTags.map((tag) => (
              <label className="feature-flag" key={tag}>
                <input
                  type="checkbox"
                  checked={selected.reasonTags.includes(tag)}
                  onChange={() => {
                    const updated = toggleClipReasonTag(selected, tag);
                    void persist(
                      clips.map((clip) =>
                        clip.id === updated.id ? updated : clip,
                      ),
                    );
                  }}
                />
                {tag.replaceAll("_", " ")}
              </label>
            ))}
          </fieldset>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const updated = applyCurationKey(
                  selected,
                  "nudge_start_left",
                );
                void persist(
                  clips.map((clip) =>
                    clip.id === updated.id ? updated : clip,
                  ),
                );
              }}
            >
              In −0.1s
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const updated = applyCurationKey(
                  selected,
                  "nudge_start_right",
                );
                void persist(
                  clips.map((clip) =>
                    clip.id === updated.id ? updated : clip,
                  ),
                );
              }}
            >
              In +0.1s
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const updated = applyCurationKey(selected, "nudge_end_left");
                void persist(
                  clips.map((clip) =>
                    clip.id === updated.id ? updated : clip,
                  ),
                );
              }}
            >
              Out −0.1s
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const updated = applyCurationKey(selected, "nudge_end_right");
                void persist(
                  clips.map((clip) =>
                    clip.id === updated.id ? updated : clip,
                  ),
                );
              }}
            >
              Out +0.1s
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (
                  !window.confirm(
                    "Remove this clip proposal? The source session and master recording will be retained.",
                  )
                ) {
                  return;
                }
                const next = clips.filter((clip) => clip.id !== selected.id);
                void persist(next);
                setSelectedId(
                  next.find((clip) => clip.sessionId === sessionId)?.id,
                );
              }}
            >
              Remove proposal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
