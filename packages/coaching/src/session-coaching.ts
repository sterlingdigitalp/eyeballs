import type { CueEvent, CueRating, SessionManifest } from "../../contracts/src";
import { buildCoachedManifest, type TrainSessionState } from "./train-session";

export interface CoachedSessionSnapshot {
  manifest: SessionManifest;
  cues?: CueEvent[];
}

/**
 * Merge finished train reflection into an already-finalized session snapshot.
 * Used after ReflectionForm so completed / notes / comfortAfter persist.
 */
export function applyReflectionToSession<T extends CoachedSessionSnapshot>(
  session: T,
  train: TrainSessionState,
): T {
  const coached = buildCoachedManifest(session.manifest, train);
  return {
    ...session,
    manifest: {
      ...session.manifest,
      coaching: coached.coaching,
    },
  };
}

/** Apply a user rating to a cue in a session cue log (immutable). */
export function rateSessionCue<T extends CoachedSessionSnapshot>(
  session: T,
  cueId: string,
  rating: CueRating,
): T {
  const cues = session.cues ?? [];
  const next = cues.map((cue) =>
    cue.id === cueId ? { ...cue, rating } : cue,
  );
  return { ...session, cues: next };
}
