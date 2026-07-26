import type {
  CueEvent,
  CueKind,
  CueRating,
  DrillDefinition,
  FeedbackIntensity,
  GazeEvent,
  GazePrediction,
  GazeState,
} from "../../contracts/src";

export const FEEDBACK_POLICY_VERSION = "feedback-policy/1.0.0";

export interface NoteAllowedWindow {
  startUs: number;
  endUs: number;
  label?: string;
}

export interface FeedbackPolicyContext {
  prediction: GazePrediction;
  /** Open break duration in ms if currently in a reportable off-lens stretch; 0 otherwise. */
  openBreakDurationMs: number;
  /** True when a recovery just completed on this frame. */
  recoveryJustOccurred: boolean;
  /** Session-relative speaking state from VAD or external signal. */
  speaking: boolean;
  /** Session-relative timestamp for note-window checks (defaults to prediction time). */
  sessionRelativeUs?: number;
  /** Active note-allowed windows in session-relative microseconds. */
  noteAllowedWindows?: NoteAllowedWindow[];
  /** Feature blink flag when available (also uses prediction.blinkSuppressed). */
  blink?: boolean;
  /** Override intensity; defaults to drill policy level. */
  intensity?: FeedbackIntensity;
}

export interface FeedbackPolicyConfig {
  drill: DrillDefinition;
  intensity?: FeedbackIntensity;
}

function intensityAllowsCues(intensity: FeedbackIntensity): boolean {
  return intensity !== "off" && intensity !== "review_only";
}

function kindForIntensity(
  intensity: FeedbackIntensity,
  longBreak: boolean,
): CueKind {
  if (intensity === "minimal") return "halo";
  if (intensity === "active" && longBreak) return "pulse";
  if (intensity === "active") return "pulse";
  return longBreak ? "pulse" : "halo";
}

function inNoteAllowedWindow(
  timestampUs: number,
  windows: NoteAllowedWindow[] | undefined,
): boolean {
  if (!windows?.length) return false;
  return windows.some((window) => timestampUs >= window.startUs && timestampUs < window.endUs);
}

function noteAllowedThresholdMs(drill: DrillDefinition): number {
  return (
    drill.contactPolicy.noteAllowedNearLensMs ??
    Math.max(drill.contactPolicy.reportableBreakMinMs * 2, 1500)
  );
}

/**
 * Pure feedback policy engine.
 * Emits restrained cues only after thresholds; never on blink or unknown tracking;
 * respects cooldown, per-drill and note-allowed policy; logs evidence on every cue.
 */
export class FeedbackPolicyEngine {
  private lastCueAtUs = -Infinity;
  private recoveryAckPending = false;
  private recoveryAckedForBreak = false;
  private openBreakStartUs: number | undefined;
  private readonly cues: CueEvent[] = [];
  private idCounter = 0;

  constructor(private readonly config: FeedbackPolicyConfig) {}

  get cueLog(): readonly CueEvent[] {
    return this.cues;
  }

  rateCue(cueId: string, rating: CueRating): CueEvent | undefined {
    const cue = this.cues.find((entry) => entry.id === cueId);
    if (!cue) return undefined;
    cue.rating = rating;
    return cue;
  }

  /** Ingest a gaze event stream fragment to keep break/recovery bookkeeping aligned. */
  observeEvents(events: GazeEvent[]): void {
    for (const event of events) {
      if (event.type === "break") {
        this.openBreakStartUs = event.startUs;
        this.recoveryAckedForBreak = false;
      }
      if (event.type === "recovery") {
        this.openBreakStartUs = undefined;
        this.recoveryAckPending = true;
      }
    }
  }

  evaluate(context: FeedbackPolicyContext): CueEvent | undefined {
    const intensity =
      context.intensity ?? this.config.intensity ?? this.config.drill.contactPolicy.feedbackLevel;
    const prediction = context.prediction;
    const timestampUs = prediction.timestampUs;
    const evidence: string[] = [];

    if (!intensityAllowsCues(intensity)) {
      return undefined;
    }

    const blink = context.blink === true || prediction.blinkSuppressed;
    if (blink) {
      return undefined;
    }
    if (prediction.state === "unknown") {
      return undefined;
    }
    if (prediction.confidence < 0.35) {
      return this.maybeEmit({
        kind: "recalibration_warning",
        timestampUs,
        evidence: [
          `low_confidence=${prediction.confidence.toFixed(2)}`,
          "tracking_quality_poor",
        ],
        intensity,
      });
    }

    // Recovery acknowledgement: once per break when contact resumes.
    if (context.recoveryJustOccurred || this.recoveryAckPending) {
      this.recoveryAckPending = false;
      if (!this.recoveryAckedForBreak && intensity === "active") {
        this.recoveryAckedForBreak = true;
        return this.maybeEmit({
          kind: "recovery_ack",
          timestampUs,
          evidence: ["recovery_confirmed", `state=${prediction.state}`],
          intensity,
          bypassCooldown: true,
        });
      }
    }

    if (prediction.state === "contact" || prediction.state === "near_lens") {
      this.openBreakStartUs = undefined;
      return undefined;
    }

    // off_lens path
    if (this.openBreakStartUs === undefined) {
      this.openBreakStartUs = timestampUs;
    }
    const breakDurationMs =
      context.openBreakDurationMs > 0
        ? context.openBreakDurationMs
        : Math.max(0, (timestampUs - this.openBreakStartUs) / 1000);

    const sessionUs = context.sessionRelativeUs ?? timestampUs;
    const notesAllowed = inNoteAllowedWindow(sessionUs, context.noteAllowedWindows);
    const thresholdMs = notesAllowed
      ? noteAllowedThresholdMs(this.config.drill)
      : this.config.drill.contactPolicy.reportableBreakMinMs;
    const micro = this.config.drill.contactPolicy.microGlanceToleranceMs;

    if (breakDurationMs < micro) {
      return undefined;
    }
    if (breakDurationMs < thresholdMs) {
      return undefined;
    }

    evidence.push(`state=${prediction.state as GazeState}`);
    evidence.push(`break_ms=${Math.round(breakDurationMs)}`);
    evidence.push(`threshold_ms=${thresholdMs}`);
    if (notesAllowed) evidence.push("note_allowed_window");
    if (context.speaking) evidence.push("speaking");
    evidence.push(`drill=${this.config.drill.id}`);
    evidence.push(`intensity=${intensity}`);

    const longBreakMin =
      this.config.drill.contactPolicy.longBreakMinMs ?? thresholdMs * 2;
    const kind = kindForIntensity(intensity, breakDurationMs >= longBreakMin);

    return this.maybeEmit({
      kind,
      timestampUs,
      evidence,
      intensity,
      breakDurationMs,
    });
  }

  private maybeEmit(args: {
    kind: CueKind;
    timestampUs: number;
    evidence: string[];
    intensity: FeedbackIntensity;
    breakDurationMs?: number;
    bypassCooldown?: boolean;
  }): CueEvent | undefined {
    if (args.kind === "none") return undefined;
    const cooldownMs = this.config.drill.contactPolicy.feedbackCooldownMs;
    if (
      !args.bypassCooldown &&
      args.timestampUs - this.lastCueAtUs < cooldownMs * 1000
    ) {
      return undefined;
    }
    if (args.evidence.length === 0) {
      throw new Error("Cue events must carry evidence");
    }
    this.idCounter += 1;
    const cue: CueEvent = {
      id: `cue-${this.idCounter}`,
      kind: args.kind,
      timestampUs: args.timestampUs,
      evidence: args.evidence,
      drillId: this.config.drill.id,
      breakDurationMs: args.breakDurationMs,
    };
    this.cues.push(cue);
    this.lastCueAtUs = args.timestampUs;
    return cue;
  }
}

/** Build note-allowed windows from drill definition and session start. */
export function noteWindowsFromDrill(
  drill: DrillDefinition,
  sessionStartUs: number,
): NoteAllowedWindow[] {
  return drill.noteAllowedIntervals.map((interval) => ({
    startUs: sessionStartUs + Math.round(interval.startSec * 1_000_000),
    endUs: sessionStartUs + Math.round(interval.endSec * 1_000_000),
    label: interval.label,
  }));
}
