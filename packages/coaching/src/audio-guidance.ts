import type { DrillDefinition } from "../../contracts/src";

export const AUDIO_GUIDANCE_VERSION = "hands-free-audio/1.0.0";
export const HANDS_FREE_SETTLE_SECONDS = 4;

export type CoachingToneKind = "settle" | "start" | "complete";

export interface CoachingToneStep {
  frequencyHz: number;
  durationMs: number;
  gapAfterMs: number;
}

export const COACHING_TONE_PATTERNS: Record<
  CoachingToneKind,
  readonly CoachingToneStep[]
> = {
  settle: [{ frequencyHz: 520, durationMs: 160, gapAfterMs: 0 }],
  start: [{ frequencyHz: 880, durationMs: 190, gapAfterMs: 0 }],
  complete: [
    { frequencyHz: 660, durationMs: 150, gapAfterMs: 70 },
    { frequencyHz: 880, durationMs: 240, gapAfterMs: 0 },
  ],
};

/**
 * One concise instruction intended to let the user stay oriented toward the
 * physical lens instead of reading the app.
 */
export function handsFreeInstruction(drill: DrillDefinition): string {
  const task = drill.prompt.text.trim();
  const taskSentence = task ? `${task} ` : "";
  return `${drill.name}. ${taskSentence}Look directly at the camera lens. Relax your face and eyes. Begin after the start tone.`;
}

/** Timed coaching drills auto-finish; open-ended live assist never does. */
export function shouldAutoCompleteHandsFreeDrill(
  drill: DrillDefinition,
  elapsedActiveSec: number,
): boolean {
  return !drill.liveAssist && elapsedActiveSec >= drill.durationTargetSec;
}
