import type { TranscriptWord } from "../../contracts/src";
import type { SpeakingWindow } from "../../coaching/src/speaking";

export const SPEECH_STRUCTURE_VERSION = "speech-structure/1.0.0";

export type SpeechStructureEventKind =
  | "long_pause"
  | "false_start_candidate"
  | "retake_candidate"
  | "interruption_candidate";

export interface SpeechStructureEvent {
  id: string;
  kind: SpeechStructureEventKind;
  startUs: number;
  endUs: number;
  confidence: number;
  evidence: string[];
}

export interface SpeechStructureAnalysis {
  version: typeof SPEECH_STRUCTURE_VERSION;
  sessionId: string;
  events: SpeechStructureEvent[];
}

export interface SpeechStructureConfig {
  longPauseUs: number;
  falseStartPauseUs: number;
  maxFalseStartWords: number;
  minRetakeWords: number;
  maxRetakeWords: number;
  maxRetakeSeparationUs: number;
  minInterruptionGapUs: number;
  maxInterruptionGapUs: number;
}

export const DEFAULT_SPEECH_STRUCTURE_CONFIG: SpeechStructureConfig = {
  longPauseUs: 1_500_000,
  falseStartPauseUs: 800_000,
  maxFalseStartWords: 4,
  minRetakeWords: 2,
  maxRetakeWords: 6,
  maxRetakeSeparationUs: 15_000_000,
  minInterruptionGapUs: 300_000,
  maxInterruptionGapUs: 1_500_000,
};

const terminalPunctuation = /[.!?]["']?$/;

function normalizedToken(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "");
}

function eventId(
  sessionId: string,
  kind: SpeechStructureEventKind,
  startUs: number,
  endUs: number,
): string {
  return `${sessionId}-${kind}-${startUs}-${endUs}`;
}

function pushUnique(
  events: SpeechStructureEvent[],
  event: SpeechStructureEvent,
): void {
  if (
    !events.some(
      (existing) =>
        existing.kind === event.kind &&
        existing.startUs === event.startUs &&
        existing.endUs === event.endUs,
    )
  ) {
    events.push(event);
  }
}

function phraseText(words: readonly TranscriptWord[]): string {
  return words.map((word) => word.text).join(" ");
}

/**
 * Produce deterministic post-session review hints from timestamped words and
 * VAD windows. Candidate labels require human review; they are not ground
 * truth and never modify the transcript.
 */
export function detectSpeechStructure(
  sessionId: string,
  words: readonly TranscriptWord[],
  speakingWindows: readonly SpeakingWindow[] = [],
  config: SpeechStructureConfig = DEFAULT_SPEECH_STRUCTURE_CONFIG,
): SpeechStructureAnalysis {
  const orderedWords = [...words].sort(
    (first, second) => first.startUs - second.startUs,
  );
  const events: SpeechStructureEvent[] = [];

  for (let index = 1; index < orderedWords.length; index += 1) {
    const previous = orderedWords[index - 1];
    const current = orderedWords[index];
    const gapUs = current.startUs - previous.endUs;
    if (gapUs >= config.longPauseUs) {
      pushUnique(events, {
        id: eventId(
          sessionId,
          "long_pause",
          previous.endUs,
          current.startUs,
        ),
        kind: "long_pause",
        startUs: previous.endUs,
        endUs: current.startUs,
        confidence: Math.min(1, gapUs / (config.longPauseUs * 2)),
        evidence: [`${Math.round(gapUs / 100_000) / 10}s between words`],
      });
    }

    if (gapUs >= config.falseStartPauseUs && !terminalPunctuation.test(previous.text)) {
      let fragmentStart = index - 1;
      while (
        fragmentStart > 0 &&
        index - fragmentStart < config.maxFalseStartWords &&
        !terminalPunctuation.test(orderedWords[fragmentStart - 1].text)
      ) {
        fragmentStart -= 1;
      }
      const fragment = orderedWords.slice(fragmentStart, index);
      if (fragment.length <= config.maxFalseStartWords) {
        pushUnique(events, {
          id: eventId(
            sessionId,
            "false_start_candidate",
            fragment[0].startUs,
            previous.endUs,
          ),
          kind: "false_start_candidate",
          startUs: fragment[0].startUs,
          endUs: previous.endUs,
          confidence: 0.65,
          evidence: [
            `unfinished ${fragment.length}-word fragment before ${Math.round(gapUs / 100_000) / 10}s pause`,
            phraseText(fragment),
          ],
        });
      }
    }
  }

  const tokens = orderedWords.map((word) => normalizedToken(word.text));
  const usedRetakeStarts = new Set<number>();
  for (let first = 0; first < orderedWords.length; first += 1) {
    if (!tokens[first]) continue;
    for (
      let second = first + config.minRetakeWords;
      second < orderedWords.length;
      second += 1
    ) {
      if (
        orderedWords[second].startUs - orderedWords[first].startUs >
        config.maxRetakeSeparationUs
      ) {
        break;
      }
      let length = 0;
      while (
        length < config.maxRetakeWords &&
        second + length < orderedWords.length &&
        tokens[first + length] &&
        tokens[first + length] === tokens[second + length]
      ) {
        length += 1;
      }
      if (
        length < config.minRetakeWords ||
        usedRetakeStarts.has(second)
      ) {
        continue;
      }
      const firstAttempt = orderedWords.slice(first, first + length);
      const repeatedAttempt = orderedWords.slice(second, second + length);
      usedRetakeStarts.add(second);
      pushUnique(events, {
        id: eventId(
          sessionId,
          "retake_candidate",
          repeatedAttempt[0].startUs,
          repeatedAttempt.at(-1)!.endUs,
        ),
        kind: "retake_candidate",
        startUs: repeatedAttempt[0].startUs,
        endUs: repeatedAttempt.at(-1)!.endUs,
        confidence: Math.min(0.95, 0.55 + length * 0.08),
        evidence: [
          `${length}-word phrase repeats within ${Math.round((repeatedAttempt[0].startUs - firstAttempt[0].startUs) / 100_000) / 10}s`,
          phraseText(repeatedAttempt),
        ],
      });
      pushUnique(events, {
        id: eventId(
          sessionId,
          "false_start_candidate",
          firstAttempt[0].startUs,
          firstAttempt.at(-1)!.endUs,
        ),
        kind: "false_start_candidate",
        startUs: firstAttempt[0].startUs,
        endUs: firstAttempt.at(-1)!.endUs,
        confidence: Math.min(0.9, 0.5 + length * 0.08),
        evidence: [
          "earlier attempt precedes a repeated phrase",
          phraseText(firstAttempt),
        ],
      });
      break;
    }
  }

  const windows = [...speakingWindows].sort(
    (first, second) => first.startUs - second.startUs,
  );
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];
    const gapUs = current.startUs - previous.endUs;
    if (
      gapUs < config.minInterruptionGapUs ||
      gapUs > config.maxInterruptionGapUs
    ) {
      continue;
    }
    const precedingWord = [...orderedWords]
      .reverse()
      .find((word) => word.endUs <= previous.endUs + 250_000);
    const followingWord = orderedWords.find(
      (word) => word.startUs >= current.startUs - 250_000,
    );
    if (
      !precedingWord ||
      !followingWord ||
      terminalPunctuation.test(precedingWord.text)
    ) {
      continue;
    }
    pushUnique(events, {
      id: eventId(
        sessionId,
        "interruption_candidate",
        previous.endUs,
        current.startUs,
      ),
      kind: "interruption_candidate",
      startUs: previous.endUs,
      endUs: current.startUs,
      confidence: 0.55,
      evidence: [
        `speech stops for ${Math.round(gapUs / 100_000) / 10}s inside an unfinished utterance`,
        `${precedingWord.text} … ${followingWord.text}`,
      ],
    });
  }

  events.sort(
    (first, second) =>
      first.startUs - second.startUs ||
      first.endUs - second.endUs ||
      first.kind.localeCompare(second.kind),
  );
  return { version: SPEECH_STRUCTURE_VERSION, sessionId, events };
}
