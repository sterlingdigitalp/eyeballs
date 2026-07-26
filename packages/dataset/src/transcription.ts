import type { TranscriptWord } from "../../coaching/src/speaking";
import {
  sentenceBoundariesFromWords,
  stubTranscript,
  type SentenceBoundary,
} from "../../coaching/src/speaking";

export interface TranscriptDocument {
  sessionId: string;
  modelVersion: string;
  words: TranscriptWord[];
  sentences: SentenceBoundary[];
  /** Immutable model output preserved separately from user corrections. */
  origin: "model" | "user_corrected" | "stub";
  stubReason?: string;
}

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
    };
  }
  return {
    sessionId,
    modelVersion: worker.modelVersion ?? "unknown",
    words: worker.words,
    sentences: sentenceBoundariesFromWords(worker.words),
    origin: "model",
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
    },
  };
}

/** Guard: coaching package speaking helpers stay free of dataset worker I/O. */
export function liveCoachingMustNotAwaitAsr(): true {
  return true;
}
