import type { ClipCandidate } from "../../contracts/src";

export interface DuplicateSignalInput {
  clip: ClipCandidate;
  transcriptText?: string;
  audioFingerprint?: string;
  framePerceptualHash?: string;
  lookBackgroundKey?: string;
}

export interface DuplicatePair {
  leftId: string;
  rightId: string;
  reasons: string[];
  score: number;
}

function normalizeTranscript(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function jaccardTokens(a: string, b: string): number {
  const left = new Set(normalizeTranscript(a).split(" ").filter(Boolean));
  const right = new Set(normalizeTranscript(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  return inter / (left.size + right.size - inter);
}

function temporalOverlap(a: ClipCandidate, b: ClipCandidate): number {
  if (a.sessionId !== b.sessionId) return 0;
  const start = Math.max(a.startUs, b.startUs);
  const end = Math.min(a.endUs, b.endUs);
  if (end <= start) return 0;
  const overlap = end - start;
  const shorter = Math.min(a.endUs - a.startUs, b.endUs - b.startUs);
  return shorter > 0 ? overlap / shorter : 0;
}

/**
 * Non-biometric near-duplicate detection: transcript, audio fp, temporal overlap,
 * perceptual hash, same look/background. No identity embeddings.
 */
export function findNearDuplicates(
  items: DuplicateSignalInput[],
  options: { transcriptThreshold?: number; overlapThreshold?: number } = {},
): DuplicatePair[] {
  const transcriptThreshold = options.transcriptThreshold ?? 0.85;
  const overlapThreshold = options.overlapThreshold ?? 0.7;
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i];
      const right = items[j];
      const reasons: string[] = [];
      let score = 0;

      if (left.transcriptText && right.transcriptText) {
        const sim = jaccardTokens(left.transcriptText, right.transcriptText);
        if (sim >= transcriptThreshold) {
          reasons.push(`transcript_similarity=${sim.toFixed(2)}`);
          score += sim;
        }
      }
      if (
        left.audioFingerprint &&
        right.audioFingerprint &&
        left.audioFingerprint === right.audioFingerprint
      ) {
        reasons.push("audio_fingerprint_match");
        score += 1;
      }
      if (
        left.framePerceptualHash &&
        right.framePerceptualHash &&
        left.framePerceptualHash === right.framePerceptualHash
      ) {
        reasons.push("frame_phash_match");
        score += 0.8;
      }
      const overlap = temporalOverlap(left.clip, right.clip);
      if (overlap >= overlapThreshold) {
        reasons.push(`temporal_overlap=${overlap.toFixed(2)}`);
        score += overlap;
      }
      if (
        left.lookBackgroundKey &&
        right.lookBackgroundKey &&
        left.lookBackgroundKey === right.lookBackgroundKey &&
        left.transcriptText &&
        right.transcriptText &&
        jaccardTokens(left.transcriptText, right.transcriptText) > 0.5
      ) {
        reasons.push("same_look_background_and_similar_speech");
        score += 0.5;
      }

      if (reasons.length) {
        pairs.push({
          leftId: left.clip.id,
          rightId: right.clip.id,
          reasons,
          score,
        });
      }
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

export function usesIdentityEmbeddings(): false {
  return false;
}
