import type {
  SentenceBoundary,
  TranscriptDocument,
  TranscriptWord,
} from "../../contracts/src";
import {
  sentenceBoundariesFromWords,
  stubTranscript,
} from "../../coaching/src/speaking";

export type { TranscriptDocument } from "../../contracts/src";

export interface AsrWorkerResult {
  status: "succeeded" | "failed" | "absent";
  modelVersion?: string;
  words?: TranscriptWord[];
  error?: string;
}

/**
 * Fill transcript structures from a worker result without blocking live coaching.
 * Live modules must not import this as an await path — call post-session only.
 */
export function materializeTranscript(
  sessionId: string,
  worker: AsrWorkerResult,
): TranscriptDocument {
  if (worker.status !== "succeeded" || !worker.words) {
    const stub = stubTranscript(worker.error ?? "asr_worker_absent_or_failed");
    return {
      sessionId,
      modelVersion: worker.modelVersion ?? "none",
      words: stub.words,
      sentences: stub.sentences,
      origin: "stub",
      stubReason: stub.stubReason,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    sessionId,
    modelVersion: worker.modelVersion ?? "unknown",
    words: worker.words,
    sentences: sentenceBoundariesFromWords(worker.words),
    origin: "model",
    updatedAt: new Date().toISOString(),
  };
}

export function applyTranscriptCorrections(
  original: TranscriptDocument,
  correctedWords: TranscriptWord[],
): { original: TranscriptDocument; corrected: TranscriptDocument } {
  if (original.origin === "user_corrected") {
    throw new Error("Original transcript must remain model/stub output");
  }
  return {
    original,
    corrected: {
      sessionId: original.sessionId,
      modelVersion: original.modelVersion,
      words: correctedWords,
      sentences: sentenceBoundariesFromWords(correctedWords),
      origin: "user_corrected",
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Replace sentence boundaries without mutating the original ASR document.
 * Boundaries are sorted and reindexed; overlaps are rejected because they make
 * review markers and sentence-level metrics ambiguous.
 */
export function applySentenceBoundaryCorrections(
  original: TranscriptDocument,
  correctedSentences: SentenceBoundary[],
  correctedWords: TranscriptWord[] = original.words,
): { original: TranscriptDocument; corrected: TranscriptDocument } {
  if (original.origin === "user_corrected") {
    throw new Error("Original transcript must remain model/stub output");
  }
  const sentences = correctedSentences
    .map((sentence) => ({
      ...sentence,
      text: sentence.text.trim(),
    }))
    .sort((first, second) => first.startUs - second.startUs)
    .map((sentence, index) => ({ ...sentence, index }));
  sentences.forEach((sentence, index) => {
    if (!sentence.text) throw new Error("Sentence text cannot be empty");
    if (sentence.endUs <= sentence.startUs) {
      throw new Error("Sentence end must be after its start");
    }
    const previous = sentences[index - 1];
    if (previous && sentence.startUs < previous.endUs) {
      throw new Error("Sentence boundaries cannot overlap");
    }
  });
  return {
    original,
    corrected: {
      sessionId: original.sessionId,
      modelVersion: original.modelVersion,
      words: correctedWords,
      sentences,
      origin: "user_corrected",
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Guard: coaching package speaking helpers stay free of dataset worker I/O. */
export function liveCoachingMustNotAwaitAsr(): true {
  return true;
}
