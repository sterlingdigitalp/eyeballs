import type {
  DrillDefinition,
  FeedbackIntensity,
  SessionCoaching,
  SessionManifest,
} from "../../contracts/src";
import { stampDrillOnSession } from "./drills";

export type TrainPhase =
  | "select"
  | "configure"
  | "countdown"
  | "active"
  | "reflect"
  | "complete"
  | "stopped";

export type RecordingStateLabel =
  | "NOT RECORDING"
  | "RECORDING"
  | "LIVE ASSIST — NOT RECORDING"
  | "LIVE ASSIST — RECORDING";

export interface TrainSessionConfig {
  drill: DrillDefinition;
  feedbackIntensity: FeedbackIntensity;
  sessionGoal?: string;
  comfortBefore?: number;
  record: boolean;
  liveAssist?: boolean;
  countdownSec?: number;
}

export interface TrainSessionState {
  phase: TrainPhase;
  config: TrainSessionConfig;
  countdownRemainingSec: number;
  elapsedActiveSec: number;
  emergencyStopped: boolean;
  recording: boolean;
  completed: boolean;
  reflectionNotes: string[];
  comfortAfter?: number;
}

export function createTrainSession(config: TrainSessionConfig): TrainSessionState {
  return {
    phase: "configure",
    config: {
      ...config,
      liveAssist: config.liveAssist ?? config.drill.liveAssist,
      countdownSec: config.countdownSec ?? 3,
      record: config.liveAssist || config.drill.recordingDefault === "off" ? false : config.record,
    },
    countdownRemainingSec: config.countdownSec ?? 3,
    elapsedActiveSec: 0,
    emergencyStopped: false,
    recording: false,
    completed: false,
    reflectionNotes: [],
  };
}

/** Default recording intent from drill content (never auto-record after restart). */
export function defaultRecordingIntent(drill: DrillDefinition): boolean {
  return drill.recordingDefault === "on";
}

export function recordingStateLabel(state: TrainSessionState): RecordingStateLabel {
  const live = Boolean(state.config.liveAssist);
  if (live && state.recording) return "LIVE ASSIST — RECORDING";
  if (live) return "LIVE ASSIST — NOT RECORDING";
  if (state.recording) return "RECORDING";
  return "NOT RECORDING";
}

export function beginCountdown(state: TrainSessionState): TrainSessionState {
  if (state.phase !== "configure" && state.phase !== "select") {
    throw new Error(`Cannot begin countdown from ${state.phase}`);
  }
  return {
    ...state,
    phase: "countdown",
    countdownRemainingSec: state.config.countdownSec ?? 3,
    emergencyStopped: false,
    recording: false,
    elapsedActiveSec: 0,
  };
}

export function tickCountdown(state: TrainSessionState): TrainSessionState {
  if (state.phase !== "countdown") return state;
  const next = state.countdownRemainingSec - 1;
  if (next > 0) {
    return { ...state, countdownRemainingSec: next };
  }
  return {
    ...state,
    phase: "active",
    countdownRemainingSec: 0,
    recording: state.config.record,
    elapsedActiveSec: 0,
  };
}

export function tickActive(state: TrainSessionState, deltaSec = 1): TrainSessionState {
  if (state.phase !== "active") return state;
  return {
    ...state,
    elapsedActiveSec: state.elapsedActiveSec + deltaSec,
  };
}

/** Emergency stop is always available from countdown or active; ends without completion credit. */
export function emergencyStop(state: TrainSessionState): TrainSessionState {
  if (state.phase !== "countdown" && state.phase !== "active") {
    return state;
  }
  return {
    ...state,
    phase: "stopped",
    emergencyStopped: true,
    recording: false,
    completed: false,
  };
}

export function requestStop(state: TrainSessionState): TrainSessionState {
  if (state.phase !== "active") return state;
  return {
    ...state,
    phase: "reflect",
    recording: false,
  };
}

export function drillCompletionMet(
  drill: DrillDefinition,
  elapsedActiveSec: number,
  speakingSec: number,
): boolean {
  const minDuration = drill.completion.minimumDurationSec ?? 0;
  const minSpeaking = drill.completion.minimumSpeakingSec ?? 0;
  if (elapsedActiveSec < minDuration) return false;
  if (speakingSec < minSpeaking) return false;
  return true;
}

export function finishReflection(
  state: TrainSessionState,
  notes: string[],
  comfortAfter?: number,
  speakingSec = 0,
): TrainSessionState {
  if (state.phase !== "reflect" && state.phase !== "stopped") {
    throw new Error(`Cannot finish reflection from ${state.phase}`);
  }
  if (state.emergencyStopped) {
    return {
      ...state,
      phase: "complete",
      completed: false,
      reflectionNotes: notes,
      comfortAfter,
      recording: false,
    };
  }
  const completed = drillCompletionMet(
    state.config.drill,
    state.elapsedActiveSec,
    speakingSec,
  );
  return {
    ...state,
    phase: "complete",
    completed,
    reflectionNotes: notes,
    comfortAfter,
    recording: false,
  };
}

export function buildCoachedManifest(
  base: SessionManifest,
  state: TrainSessionState,
): SessionManifest {
  const stamped = stampDrillOnSession(base, state.config.drill, {
    feedbackIntensity: state.config.feedbackIntensity,
    sessionGoal: state.config.sessionGoal,
    comfortBefore: state.config.comfortBefore,
    liveAssist: state.config.liveAssist,
  });
  const coaching: SessionCoaching = {
    ...stamped.coaching!,
    comfortAfter: state.comfortAfter,
    reflectionNotes: state.reflectionNotes,
    completed: state.completed,
  };
  return { ...stamped, coaching };
}

/** After app restart, recording must never resume automatically. */
export function restartSafeRecordingFlag(
  previous?: { recording?: boolean } | null,
): boolean {
  void previous;
  return false;
}

export function intensityOptions(): FeedbackIntensity[] {
  return ["off", "minimal", "standard", "active", "review_only"];
}
