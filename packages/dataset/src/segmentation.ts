import type { GazeEvent, GazePrediction } from "../../contracts/src";
import type { SentenceBoundary, SpeakingWindow } from "../../coaching/src/speaking";
import type { SpeechStructureEvent } from "./speech-structure";

export interface SegmentProposal {
  id: string;
  sessionId: string;
  startUs: number;
  endUs: number;
  band: "fragment" | "short" | "medium" | "long";
  reasons: string[];
  /** Always true — proposals are ranges into master, not media copies. */
  pointsIntoMaster: true;
}

export interface SegmentProposalInput {
  sessionId: string;
  durationUs: number;
  sentences?: SentenceBoundary[];
  speakingWindows?: SpeakingWindow[];
  predictions?: GazePrediction[];
  events?: GazeEvent[];
  speechStructureEvents?: SpeechStructureEvent[];
}

function bandForDuration(durationUs: number): SegmentProposal["band"] {
  const sec = durationUs / 1_000_000;
  if (sec <= 8) return "fragment";
  if (sec <= 20) return "short";
  if (sec <= 60) return "medium";
  return "long";
}

/**
 * Propose candidate ranges. Does not copy media.
 */
export function proposeSegments(input: SegmentProposalInput): SegmentProposal[] {
  const proposals: SegmentProposal[] = [];
  const sentences = input.sentences ?? [];
  if (sentences.length) {
    for (const sentence of sentences) {
      const duration = sentence.endUs - sentence.startUs;
      if (duration < 500_000) continue;
      const lead = Math.max(0, sentence.startUs - 200_000);
      const tail = Math.min(input.durationUs, sentence.endUs + 200_000);
      proposals.push({
        id: `${input.sessionId}-sent-${sentence.index}`,
        sessionId: input.sessionId,
        startUs: lead,
        endUs: tail,
        band: bandForDuration(tail - lead),
        reasons: ["complete_sentence", "points_into_master"],
        pointsIntoMaster: true,
      });
    }
  } else if (input.speakingWindows?.length) {
    input.speakingWindows.forEach((window, index) => {
      proposals.push({
        id: `${input.sessionId}-speech-${index}`,
        sessionId: input.sessionId,
        startUs: window.startUs,
        endUs: window.endUs,
        band: bandForDuration(window.endUs - window.startUs),
        reasons: ["speaking_window", "points_into_master"],
        pointsIntoMaster: true,
      });
    });
  } else {
    // Fallback evenly spaced ranges for fixtures without speech structure
    const chunk = Math.min(10_000_000, Math.max(3_000_000, Math.floor(input.durationUs / 3)));
    for (let start = 0, i = 0; start + chunk <= input.durationUs; start += chunk, i += 1) {
      proposals.push({
        id: `${input.sessionId}-auto-${i}`,
        sessionId: input.sessionId,
        startUs: start,
        endUs: start + chunk,
        band: bandForDuration(chunk),
        reasons: ["fallback_grid", "points_into_master"],
        pointsIntoMaster: true,
      });
    }
  }

  let filtered = proposals;

  // Reject segments that contain a long gaze break (>3s) inside the range.
  if (input.events?.length) {
    filtered = filtered.filter((proposal) => {
      const longBreak = input.events!.some(
        (event) =>
          event.type === "break" &&
          event.endUs !== undefined &&
          event.startUs >= proposal.startUs &&
          event.endUs <= proposal.endUs &&
          event.endUs - event.startUs > 3_000_000,
      );
      return !longBreak;
    });
  }

  // Long pauses can provide useful edit handles. The other speech-structure
  // candidates indicate content that should not enter an automatically
  // proposed clean range without human review.
  const verbalMistakes = (input.speechStructureEvents ?? []).filter(
    (event) => event.kind !== "long_pause",
  );
  if (verbalMistakes.length) {
    filtered = filtered.filter(
      (proposal) =>
        !verbalMistakes.some(
          (event) =>
            event.startUs < proposal.endUs &&
            event.endUs > proposal.startUs,
        ),
    );
  }

  return filtered;
}
