import { useState } from "react";
import type {
  DrillDefinition,
  FeedbackIntensity,
} from "../../../../packages/contracts/src";
import {
  defaultRecordingIntent,
  intensityOptions,
  placeLensAdjacentPrompt,
  promptRegionStyle,
  resolvePromptReveal,
  type TrainSessionState,
} from "../../../../packages/coaching/src";

export function DrillSetupForm({
  drills,
  selectedId,
  onSelectId,
  intensity,
  onIntensity,
  sessionGoal,
  onSessionGoal,
  comfortBefore,
  onComfortBefore,
  record,
  onRecord,
  largeText,
  onLargeText,
  liveAssist,
  onLiveAssist,
  handsFreeAudio,
  onHandsFreeAudio,
  disabled,
}: {
  drills: DrillDefinition[];
  selectedId: string;
  onSelectId: (id: string) => void;
  intensity: FeedbackIntensity;
  onIntensity: (value: FeedbackIntensity) => void;
  sessionGoal: string;
  onSessionGoal: (value: string) => void;
  comfortBefore: number;
  onComfortBefore: (value: number) => void;
  record: boolean;
  onRecord: (value: boolean) => void;
  largeText: boolean;
  onLargeText: (value: boolean) => void;
  liveAssist: boolean;
  onLiveAssist: (value: boolean) => void;
  handsFreeAudio: boolean;
  onHandsFreeAudio: (value: boolean) => void;
  disabled?: boolean;
}) {
  const selected = drills.find((drill) => drill.id === selectedId) ?? drills[0];
  return (
    <div className="train-setup">
      <label>
        Drill
        <select
          value={selected?.id ?? ""}
          disabled={disabled}
          onChange={(event) => onSelectId(event.target.value)}
        >
          {drills.map((drill) => (
            <option key={drill.id} value={drill.id}>
              L{drill.curriculumLevel} · {drill.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Feedback intensity
        <select
          value={intensity}
          disabled={disabled}
          onChange={(event) => onIntensity(event.target.value as FeedbackIntensity)}
        >
          {intensityOptions().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        Session goal
        <input
          value={sessionGoal}
          disabled={disabled}
          placeholder="Optional goal for this run"
          onChange={(event) => onSessionGoal(event.target.value)}
        />
      </label>
      <label>
        Comfort before (1–5)
        <input
          type="number"
          min={1}
          max={5}
          value={comfortBefore}
          disabled={disabled}
          onChange={(event) => onComfortBefore(Number(event.target.value) || 3)}
        />
      </label>
      <label className="feature-flag">
        <input
          type="checkbox"
          checked={handsFreeAudio}
          disabled={disabled}
          onChange={(event) => onHandsFreeAudio(event.target.checked)}
        />
        Hands-free spoken instructions and timing tones
      </label>
      <label className="feature-flag">
        <input
          type="checkbox"
          checked={record && !liveAssist}
          disabled={disabled || liveAssist || selected?.recordingDefault === "off"}
          onChange={(event) => onRecord(event.target.checked)}
        />
        Record this session
      </label>
      <label className="feature-flag">
        <input
          type="checkbox"
          checked={largeText}
          disabled={disabled}
          onChange={(event) => onLargeText(event.target.checked)}
        />
        Large text (still lens-adjacent)
      </label>
      <label className="feature-flag">
        <input
          type="checkbox"
          checked={liveAssist}
          disabled={disabled}
          onChange={(event) => {
            onLiveAssist(event.target.checked);
            if (event.target.checked) onRecord(false);
          }}
        />
        Live assist mode (recording off by default)
      </label>
      {selected && (
        <p className="muted">
          {selected.durationTargetSec}s · {selected.prompt.revealMode} · default record:{" "}
          {defaultRecordingIntent(selected) ? "on" : selected.recordingDefault}
        </p>
      )}
    </div>
  );
}

export interface CustomOutlineInput {
  name: string;
  outline: string;
  durationTargetSec: number;
  phraseStartSec?: number[];
}

export function CustomDrillImport({
  onCreate,
  drills = [],
  onUpdate,
  onDelete,
  disabled,
}: {
  onCreate: (input: CustomOutlineInput) => Promise<void>;
  drills?: DrillDefinition[];
  onUpdate?: (
    drill: DrillDefinition,
    input: CustomOutlineInput,
  ) => Promise<void>;
  onDelete?: (drill: DrillDefinition) => Promise<void>;
  disabled?: boolean;
}) {
  const [name, setName] = useState("");
  const [outline, setOutline] = useState("");
  const [durationTargetSec, setDurationTargetSec] = useState(90);
  const [phraseStartText, setPhraseStartText] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const reset = () => {
    setName("");
    setOutline("");
    setDurationTargetSec(90);
    setPhraseStartText("");
    setEditingId(undefined);
  };

  const submit = async () => {
    if (!outline.trim()) {
      setError("Paste at least one outline line.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const phraseStartSec = phraseStartText.trim()
        ? phraseStartText
            .split(",")
            .map((value) => Number(value.trim()))
        : undefined;
      if (phraseStartSec?.some((value) => !Number.isFinite(value))) {
        throw new Error("Beat start times must be comma-separated numbers.");
      }
      const input = {
        name: name.trim() || "Custom outline rehearsal",
        outline,
        durationTargetSec,
        phraseStartSec,
      };
      const existing = drills.find((drill) => drill.id === editingId);
      if (existing && onUpdate) {
        await onUpdate(existing, input);
      } else {
        await onCreate(input);
      }
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const edit = (drill: DrillDefinition) => {
    setEditingId(drill.id);
    setName(drill.name);
    setDurationTargetSec(drill.durationTargetSec);
    setOutline(
      drill.prompt.phrases?.join("\n") || drill.prompt.text,
    );
    setPhraseStartText(drill.prompt.phraseStartSec?.join(", ") ?? "");
    setError(undefined);
  };

  const remove = async (drill: DrillDefinition) => {
    if (
      !onDelete ||
      !window.confirm(
        `Delete “${drill.name}”? Past sessions keep their saved drill snapshot.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onDelete(drill);
      if (editingId === drill.id) reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="panel custom-drill-import">
      <summary>Custom rehearsal outlines ({drills.length})</summary>
      <p className="muted">
        Paste plain text or Markdown. Each heading or bullet becomes a
        lens-adjacent outline beat. Editing creates a new drill version; past
        sessions retain their original snapshot.
      </p>
      <label>
        Drill name
        <input
          value={name}
          disabled={disabled || saving}
          placeholder="My presentation rehearsal"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Target duration (seconds)
        <input
          type="number"
          min={30}
          max={600}
          value={durationTargetSec}
          disabled={disabled || saving}
          onChange={(event) =>
            setDurationTargetSec(
              Math.min(600, Math.max(30, Number(event.target.value) || 90)),
            )
          }
        />
      </label>
      <label>
        Plain-text or Markdown outline
        <textarea
          value={outline}
          disabled={disabled || saving}
          placeholder={"# Opening\n- Main claim\n- Evidence\n- Next step"}
          onChange={(event) => setOutline(event.target.value)}
        />
      </label>
      <label>
        Beat start times in seconds (optional)
        <input
          value={phraseStartText}
          disabled={disabled || saving}
          placeholder="0, 15, 45"
          onChange={(event) => setPhraseStartText(event.target.value)}
        />
      </label>
      <p className="muted">
        Enter one increasing start time per outline beat, beginning with 0.
        Leave blank to advance beats at the default interval.
      </p>
      {error && <p className="tracking-warning">{error}</p>}
      <button
        type="button"
        className="secondary"
        disabled={disabled || saving}
        onClick={() => void submit()}
      >
        {saving
          ? "Saving…"
          : editingId
            ? "Save new drill version"
            : "Create rehearsal drill"}
      </button>
      {editingId && (
        <button
          type="button"
          className="secondary"
          disabled={disabled || saving}
          onClick={reset}
        >
          Cancel edit
        </button>
      )}
      {drills.map((drill) => (
        <div className="cue-rating-row" key={drill.id}>
          <span>
            {drill.name} · v{drill.version} · {drill.durationTargetSec}s ·{" "}
            {drill.prompt.phrases?.length ?? 1} beats
          </span>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              disabled={disabled || saving}
              onClick={() => edit(drill)}
            >
              Edit
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled || saving}
              onClick={() => void remove(drill)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </details>
  );
}

export function LensAdjacentPromptOverlay({
  drill,
  anchor,
  elapsedSec,
  speaking,
  largeText,
  hiddenOverride,
}: {
  drill: DrillDefinition;
  anchor: { x: number; y: number };
  elapsedSec: number;
  speaking: boolean;
  largeText?: boolean;
  hiddenOverride?: boolean;
}) {
  const region = placeLensAdjacentPrompt({ anchor, largeText });
  const style = promptRegionStyle(region);
  const reveal = resolvePromptReveal({ drill, elapsedSec, speaking });
  if (reveal.hidden || hiddenOverride || !reveal.visibleText) return null;
  return (
    <div
      className="lens-prompt"
      style={style}
      data-reveal-mode={reveal.mode}
      aria-live="polite"
    >
      {reveal.visibleText}
    </div>
  );
}

export function RecordingPrivacyBadge({
  label,
}: {
  label: string;
}) {
  const recording = label.includes("RECORDING") && !label.includes("NOT RECORDING");
  return (
    <div
      className={`recording-privacy ${recording ? "is-recording" : "not-recording"}`}
      role="status"
      aria-live="polite"
      data-privacy-state={label}
    >
      {label}
    </div>
  );
}

export function TrainActiveChrome({
  train,
  onEmergencyStop,
  onStop,
}: {
  train: TrainSessionState;
  onEmergencyStop: () => void;
  onStop: () => void;
}) {
  return (
    <div className="train-active-chrome">
      <RecordingPrivacyBadge label={
        train.config.liveAssist
          ? train.recording
            ? "LIVE ASSIST — RECORDING"
            : "LIVE ASSIST — NOT RECORDING"
          : train.recording
            ? "RECORDING"
            : "NOT RECORDING"
      } />
      {train.phase === "countdown" && (
        <p className="countdown-display" aria-live="assertive">
          Starting in {train.countdownRemainingSec}
        </p>
      )}
      {train.phase === "active" && (
        <p className="muted">
          {train.config.drill.name}
          {train.config.sessionGoal ? ` · ${train.config.sessionGoal}` : ""}
        </p>
      )}
      <div className="button-row">
        {(train.phase === "countdown" || train.phase === "active") && (
          <button type="button" className="emergency-stop" onClick={onEmergencyStop}>
            Emergency stop
          </button>
        )}
        {train.phase === "active" && (
          <button type="button" className="stop" onClick={onStop}>
            {train.recording ? "Stop and save" : "Stop practice"}
          </button>
        )}
      </div>
    </div>
  );
}

export function ReflectionForm({
  reflectionPrompts,
  onFinish,
}: {
  reflectionPrompts: string[];
  onFinish: (notes: string[], comfortAfter: number) => void;
}) {
  const [notes, setNotes] = useState("");
  const [comfortAfter, setComfortAfter] = useState(3);
  return (
    <div className="reflection-form">
      <h2>Reflection</h2>
      {reflectionPrompts.map((prompt) => (
        <p key={prompt} className="muted">
          {prompt}
        </p>
      ))}
      <label>
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <label>
        Comfort after (1–5)
        <input
          type="number"
          min={1}
          max={5}
          value={comfortAfter}
          onChange={(event) => setComfortAfter(Number(event.target.value) || 3)}
        />
      </label>
      <button
        type="button"
        onClick={() =>
          onFinish(
            notes
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
            comfortAfter,
          )
        }
      >
        Finish session
      </button>
    </div>
  );
}
