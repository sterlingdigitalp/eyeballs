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
