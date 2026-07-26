import type { DrillDefinition, PromptRevealMode } from "../../contracts/src";

export interface LensAnchor {
  x: number;
  y: number;
}

export interface PromptRegion {
  /** Left edge as fraction of container width [0,1]. */
  left: number;
  /** Top edge as fraction of container height [0,1]. */
  top: number;
  /** Max width as fraction of container width. */
  maxWidth: number;
  /** CSS-friendly width clamp in px for large-text mode. */
  fontScale: number;
}

export interface PromptPlacementOptions {
  anchor: LensAnchor;
  largeText?: boolean;
  /** Container aspect not required; placement is fractional. */
  maxWidthFraction?: number;
}

/**
 * Place prompts in a constrained region immediately beneath the lens anchor.
 * Keeps text near the physical lens so coaching teaches camera contact, not screen center.
 */
export function placeLensAdjacentPrompt(options: PromptPlacementOptions): PromptRegion {
  const { anchor, largeText = false } = options;
  const maxWidth = Math.min(options.maxWidthFraction ?? 0.42, largeText ? 0.55 : 0.42);
  const half = maxWidth / 2;
  let left = anchor.x - half;
  left = Math.min(Math.max(left, 0.02), 1 - maxWidth - 0.02);
  // Prefer just below the lens; clamp into the upper two-thirds so the user can still see it
  // when posed at eye level (Brio lesson from Phase 1).
  let top = anchor.y + 0.04;
  top = Math.min(Math.max(top, 0.05), 0.62);
  return {
    left,
    top,
    maxWidth,
    fontScale: largeText ? 1.35 : 1,
  };
}

export interface PromptRevealState {
  visibleText: string;
  hidden: boolean;
  phraseIndex: number;
  mode: PromptRevealMode;
}

export interface PromptRevealInput {
  drill: DrillDefinition;
  /** Seconds since drill active (after countdown). */
  elapsedSec: number;
  speaking: boolean;
  /** Optional phrase index override for phrase_by_phrase. */
  phraseIndex?: number;
}

/**
 * Compute which prompt text is visible for one-line, phrase-by-phrase, and hide-on-speech modes.
 */
export function resolvePromptReveal(input: PromptRevealInput): PromptRevealState {
  const mode = input.drill.prompt.revealMode;
  const phrases =
    input.drill.prompt.phrases && input.drill.prompt.phrases.length > 0
      ? input.drill.prompt.phrases
      : input.drill.prompt.text
        ? [input.drill.prompt.text]
        : [];
  const revealSec = input.drill.prompt.revealSec ?? 0;
  const hideWhenSpeaking = input.drill.prompt.hideWhenSpeaking;

  if (phrases.length === 0 || input.drill.prompt.type === "none") {
    return { visibleText: "", hidden: true, phraseIndex: 0, mode };
  }

  if (revealSec > 0 && input.elapsedSec < revealSec && mode !== "phrase_by_phrase") {
    // Still in initial reveal window — show full prompt.
  }

  let phraseIndex = 0;
  if (mode === "phrase_by_phrase") {
    const perPhrase = Math.max(revealSec || 4, 1);
    phraseIndex =
      input.phraseIndex ??
      Math.min(phrases.length - 1, Math.floor(input.elapsedSec / perPhrase));
  }

  const text =
    mode === "phrase_by_phrase" ? phrases[phraseIndex] ?? phrases[0] : phrases[0] ?? "";

  if (hideWhenSpeaking && input.speaking) {
    return { visibleText: text, hidden: true, phraseIndex, mode };
  }

  if (mode === "hide_on_speech" && input.speaking) {
    return { visibleText: text, hidden: true, phraseIndex, mode };
  }

  return { visibleText: text, hidden: false, phraseIndex, mode };
}

export function promptRegionStyle(region: PromptRegion): {
  left: string;
  top: string;
  maxWidth: string;
  fontSize: string;
} {
  return {
    left: `${(region.left * 100).toFixed(2)}%`,
    top: `${(region.top * 100).toFixed(2)}%`,
    maxWidth: `${(region.maxWidth * 100).toFixed(2)}%`,
    fontSize: `${(1 * region.fontScale).toFixed(2)}rem`,
  };
}
