import { useMemo, useState } from "react";
import type { ClipCandidate } from "../../../../packages/contracts/src";
import {
  allClipLabels,
  applyCurationKey,
  createHumanClip,
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
  clips,
  onClipsChange,
}: {
  sessions: StoredSession[];
  clips: ClipCandidate[];
  onClipsChange: (next: ClipCandidate[]) => void;
}) {
  const coached = sessions.filter((session) => session.manifest.status === "complete");
  const [sessionId, setSessionId] = useState(coached[0]?.manifest.id ?? "");
  const [selectedId, setSelectedId] = useState(clips[0]?.id);
  const [rangeStartSec, setRangeStartSec] = useState("0");
  const [rangeEndSec, setRangeEndSec] = useState("3");
  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0];

  const sessionClips = useMemo(
    () => clips.filter((clip) => clip.sessionId === sessionId),
    [clips, sessionId],
  );

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
          <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
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
              const startUs = Math.max(0, Math.round(Number(rangeStartSec) * 1_000_000));
              const endUs = Math.max(startUs + 1, Math.round(Number(rangeEndSec) * 1_000_000));
              const clip = createHumanClip(sessionId, startUs, endUs);
              void persist([...clips, clip]);
              setSelectedId(clip.id);
            }}
          >
            Add range
          </button>
        </div>
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
                void persist(clips.map((clip) => (clip.id === updated.id ? updated : clip)));
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
