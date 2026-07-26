import type {
  GazeEvent,
  GazePrediction,
  SessionManifest,
} from "../../contracts/src";

export const PROGRESS_GROUPING_VERSION = "progress-grouping/1.0.0";

export interface SpeakingWindowLike {
  startUs: number;
  endUs: number;
}

export interface ProgressSessionInput {
  manifest: SessionManifest;
  predictions: GazePrediction[];
  events: GazeEvent[];
  unknownRatio?: number;
  /** When provided, contactDuringSpeaking only counts frames inside these windows. */
  speakingWindows?: SpeakingWindowLike[];
}

export interface ComparableKey {
  drillId: string;
  profileId: string;
  feedbackIntensity: string;
  scoringPolicyVersion: string;
}

export interface SessionTrendPoint {
  sessionId: string;
  startedAt: string;
  contactDuringSpeaking: number | null;
  breaksPerMinute: number | null;
  medianBreakMs: number | null;
  recoveryMs: number | null;
  trackingConfidence: number;
  unknownRatio: number;
  comfortBefore?: number;
  comfortAfter?: number;
  measurementDegraded: boolean;
}

export interface ProgressSeries {
  key: ComparableKey;
  baselineSessionId?: string;
  points: SessionTrendPoint[];
  trends: {
    contactDuringSpeaking: number[];
    breaksPerMinute: number[];
    medianBreakMs: number[];
    recoveryMs: number[];
    trackingConfidence: number[];
    comfortAfter: number[];
  };
}

export function comparableKey(manifest: SessionManifest): ComparableKey | undefined {
  const coaching = manifest.coaching;
  if (!coaching) return undefined;
  return {
    drillId: coaching.drillId,
    profileId: manifest.profileId,
    feedbackIntensity: coaching.feedbackIntensity,
    scoringPolicyVersion: coaching.scoringPolicyVersion,
  };
}

export function comparableKeyString(key: ComparableKey): string {
  return [
    key.drillId,
    key.profileId,
    key.feedbackIntensity,
    key.scoringPolicyVersion,
  ].join("|");
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function inSpeakingWindow(
  timestampUs: number,
  windows: SpeakingWindowLike[],
): boolean {
  return windows.some(
    (window) => timestampUs >= window.startUs && timestampUs < window.endUs,
  );
}

export function computeSessionTrendPoint(input: ProgressSessionInput): SessionTrendPoint {
  const predictions = input.predictions;
  const durationUs = Math.max(
    1,
    (predictions.at(-1)?.timestampUs ?? input.manifest.monotonicStartUs) -
      input.manifest.monotonicStartUs,
  );
  const durationMin = durationUs / 60_000_000;
  const windows = input.speakingWindows ?? [];
  // Only claim "during speaking" when speaking windows are known; otherwise null.
  let contactDuringSpeaking: number | null = null;
  if (windows.length > 0) {
    const speakingScored = predictions.filter(
      (prediction) =>
        prediction.state !== "unknown" && inSpeakingWindow(prediction.timestampUs, windows),
    );
    const speakingContact = speakingScored.filter(
      (prediction) => prediction.state === "contact",
    ).length;
    contactDuringSpeaking = speakingScored.length
      ? speakingContact / speakingScored.length
      : null;
  }
  const breaks = input.events.filter((event) => event.type === "break");
  const recoveries = input.events.filter((event) => event.type === "recovery");
  const breakDurationsMs = breaks
    .map((event) =>
      event.endUs !== undefined ? (event.endUs - event.startUs) / 1000 : undefined,
    )
    .filter((value): value is number => value !== undefined);
  // Recovery latency = time from prior break end to recovery start (evidence-based).
  const recoveryMsList: number[] = [];
  for (const recovery of recoveries) {
    const priorBreak = breaks
      .filter(
        (event) =>
          event.endUs !== undefined && event.endUs <= recovery.startUs,
      )
      .sort((a, b) => (b.endUs ?? 0) - (a.endUs ?? 0))[0];
    if (priorBreak?.endUs !== undefined) {
      recoveryMsList.push((recovery.startUs - priorBreak.endUs) / 1000);
    }
  }
  const unknownCount = predictions.filter((prediction) => prediction.state === "unknown").length;
  const unknownRatio =
    input.unknownRatio ??
    (predictions.length ? unknownCount / predictions.length : 0);
  const trackingConfidence = predictions.length
    ? predictions.reduce((sum, prediction) => sum + prediction.confidence, 0) /
      predictions.length
    : 0;
  const measurementDegraded = unknownRatio > 0.2 || trackingConfidence < 0.5;

  return {
    sessionId: input.manifest.id,
    startedAt: input.manifest.startedAt,
    contactDuringSpeaking,
    breaksPerMinute: durationMin > 0 ? breaks.length / durationMin : null,
    medianBreakMs: median(breakDurationsMs),
    recoveryMs: median(recoveryMsList),
    trackingConfidence,
    unknownRatio,
    comfortBefore: input.manifest.coaching?.comfortBefore,
    comfortAfter: input.manifest.coaching?.comfortAfter,
    measurementDegraded,
  };
}

/** Group sessions only when drill + profile + feedback mode + scoring policy match. */
export function groupComparableSessions(
  sessions: ProgressSessionInput[],
): ProgressSeries[] {
  const groups = new Map<string, { key: ComparableKey; inputs: ProgressSessionInput[] }>();
  for (const session of sessions) {
    const key = comparableKey(session.manifest);
    if (!key) continue;
    if (session.manifest.status !== "complete" && session.manifest.status !== "incomplete") {
      continue;
    }
    const id = comparableKeyString(key);
    const existing = groups.get(id);
    if (existing) existing.inputs.push(session);
    else groups.set(id, { key, inputs: [session] });
  }

  return [...groups.values()].map(({ key, inputs }) => {
    const ordered = [...inputs].sort((a, b) =>
      a.manifest.startedAt.localeCompare(b.manifest.startedAt),
    );
    const points = ordered.map(computeSessionTrendPoint);
    return {
      key,
      baselineSessionId: points[0]?.sessionId,
      points,
      trends: {
        contactDuringSpeaking: points
          .map((point) => point.contactDuringSpeaking)
          .filter((value): value is number => value !== null),
        breaksPerMinute: points
          .map((point) => point.breaksPerMinute)
          .filter((value): value is number => value !== null),
        medianBreakMs: points
          .map((point) => point.medianBreakMs)
          .filter((value): value is number => value !== null),
        recoveryMs: points
          .map((point) => point.recoveryMs)
          .filter((value): value is number => value !== null),
        trackingConfidence: points.map((point) => point.trackingConfidence),
        comfortAfter: points
          .map((point) => point.comfortAfter)
          .filter((value): value is number => value !== undefined),
      },
    };
  });
}

/** Highlight measurement degradation separately from performance change. */
export function measurementDegradationNotes(series: ProgressSeries): string[] {
  return series.points
    .filter((point) => point.measurementDegraded)
    .map(
      (point) =>
        `Session ${point.sessionId.slice(0, 8)} has weak tracking (unknown ${(point.unknownRatio * 100).toFixed(0)}%, confidence ${(point.trackingConfidence * 100).toFixed(0)}%) — do not treat metric dips as skill loss.`,
    );
}
