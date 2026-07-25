export type SessionState =
  | "idle"
  | "preflight"
  | "calibrating"
  | "ready"
  | "countdown"
  | "practicing"
  | "recording"
  | "paused"
  | "finalizing"
  | "analyzing"
  | "review_ready"
  | "reviewed"
  | "archived"
  | "device_lost"
  | "permission_denied"
  | "capture_degraded"
  | "finalization_failed"
  | "recovery_required";

export type SessionAction =
  | "begin_setup"
  | "require_calibration"
  | "calibration_complete"
  | "ready"
  | "begin_countdown"
  | "practice"
  | "record"
  | "pause"
  | "resume"
  | "stop"
  | "finalized"
  | "analyzed"
  | "review"
  | "archive"
  | "device_removed"
  | "deny_permission"
  | "degrade"
  | "finalization_error"
  | "recover"
  | "reset";

const transitions: Partial<Record<SessionState, Partial<Record<SessionAction, SessionState>>>> = {
  idle: { begin_setup: "preflight" },
  preflight: {
    require_calibration: "calibrating",
    ready: "ready",
    deny_permission: "permission_denied",
    device_removed: "device_lost",
  },
  calibrating: { calibration_complete: "ready", device_removed: "device_lost" },
  ready: { begin_countdown: "countdown", device_removed: "device_lost" },
  countdown: { practice: "practicing", record: "recording", device_removed: "device_lost" },
  practicing: { pause: "paused", stop: "finalizing", device_removed: "device_lost", degrade: "capture_degraded" },
  recording: { pause: "paused", stop: "finalizing", device_removed: "device_lost", degrade: "capture_degraded" },
  paused: { resume: "recording", stop: "finalizing", device_removed: "device_lost" },
  finalizing: { finalized: "analyzing", finalization_error: "finalization_failed" },
  analyzing: { analyzed: "review_ready" },
  review_ready: { review: "reviewed" },
  reviewed: { archive: "archived" },
  device_lost: { recover: "recovery_required", reset: "idle" },
  permission_denied: { reset: "idle" },
  capture_degraded: { stop: "finalizing", reset: "idle" },
  finalization_failed: { recover: "recovery_required", reset: "idle" },
  recovery_required: { reset: "idle" },
  archived: { reset: "idle" },
};

export function transitionSession(state: SessionState, action: SessionAction): SessionState {
  const next = transitions[state]?.[action];
  if (!next) throw new Error(`Invalid session transition: ${state} -> ${action}`);
  return next;
}
