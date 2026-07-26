import type { DrillDefinition } from "../../../../packages/contracts/src";
import {
  COACHING_TONE_PATTERNS,
  handsFreeInstruction,
  type CoachingToneKind,
} from "../../../../packages/coaching/src";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

let coachingAudioContext: AudioContext | undefined;

async function unlockCoachingAudio(): Promise<AudioContext> {
  coachingAudioContext ??= new AudioContext();
  if (coachingAudioContext.state === "suspended") {
    await coachingAudioContext.resume();
  }
  return coachingAudioContext;
}

export async function playCoachingTone(kind: CoachingToneKind): Promise<void> {
  try {
    const context = await unlockCoachingAudio();
    for (const step of COACHING_TONE_PATTERNS[kind]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = context.currentTime;
      const stopAt = startAt + step.durationMs / 1000;
      oscillator.type = "sine";
      oscillator.frequency.value = step.frequencyHz;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.075, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        Math.max(startAt + 0.03, stopAt - 0.02),
      );
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(stopAt);
      await wait(step.durationMs + step.gapAfterMs);
    }
    if (kind === "complete") {
      await context.close();
      coachingAudioContext = undefined;
    }
  } catch {
    // Visual countdown and completion state remain the accessible fallback.
  }
}

export function speakCoachingInstruction(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      resolve();
    };
    const fallback = window.setTimeout(finish, 15_000);
    utterance.addEventListener("end", finish, { once: true });
    utterance.addEventListener("error", finish, { once: true });
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

export async function prepareHandsFreeDrill(
  drill: DrillDefinition,
): Promise<void> {
  // Unlock Web Audio while the Start button's user gesture is still active so
  // the delayed start/completion tones remain audible under autoplay policy.
  await unlockCoachingAudio();
  await speakCoachingInstruction(handsFreeInstruction(drill));
  await playCoachingTone("settle");
}

export function cancelCoachingAudio(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (coachingAudioContext) {
    void coachingAudioContext.close();
    coachingAudioContext = undefined;
  }
}
