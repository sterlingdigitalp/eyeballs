import type {
  CueEvent,
  DrillDefinition,
  GazeEvent,
  GazePrediction,
  GazeState,
  ReviewBookmark,
  SessionManifest,
} from "../../contracts/src";
import type { SentenceBoundary, SpeakingWindow } from "./speaking";
import { speakingSeconds, stubTranscript } from "./speaking";

export interface TimelineSegment {
  startUs: number;
  endUs: number;
  label: string;
  kind: string;
}

export interface TimelineMarker {
  timestampUs: number;
  label: string;
  kind: string;
  id?: string;
}

export interface ReviewLane {
  id: string;
  name: string;
  segments: TimelineSegment[];
  markers: TimelineMarker[];
}

export interface MetricExclusionWindow {
  startUs: number;
  endUs: number;
  reason: string;
}

export interface ReviewTimelineInput {
  originUs: number;
  durationUs: number;
  predictions: GazePrediction[];
  events: GazeEvent[];
  cues?: CueEvent[];
  drill?: DrillDefinition;
  speakingWindows?: SpeakingWindow[];
  sentences?: SentenceBoundary[];
  bookmarks?: ReviewBookmark[];
  /** Countdown / app pause intervals to exclude from metrics. */
  exclusions?: MetricExclusionWindow[];
}

function clampDuration(durationUs: number): number {
  return Math.max(durationUs, 1);
}

function toRelative(timestampUs: number, originUs: number): number {
  return Math.max(0, timestampUs - originUs);
}

/** Build contact-state segments from predictions (relative to session origin). */
export function contactStateSegments(
  predictions: GazePrediction[],
  originUs: number,
  durationUs: number,
): TimelineSegment[] {
  if (!predictions.length) {
    return [{ startUs: 0, endUs: clampDuration(durationUs), label: "unknown", kind: "contact_state" }];
  }
  const sorted = [...predictions].sort((a, b) => a.timestampUs - b.timestampUs);
  const segments: TimelineSegment[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const startUs = toRelative(current.timestampUs, originUs);
    const endUs =
      i + 1 < sorted.length
        ? toRelative(sorted[i + 1].timestampUs, originUs)
        : clampDuration(durationUs);
    if (endUs <= startUs) continue;
    const prior = segments.at(-1);
    if (prior && prior.label === current.state && prior.endUs === startUs) {
      prior.endUs = endUs;
    } else {
      segments.push({
        startUs,
        endUs,
        label: current.state,
        kind: "contact_state",
      });
    }
  }
  return segments;
}

export function eventMarkers(events: GazeEvent[], originUs: number): TimelineMarker[] {
  return events.map((event) => ({
    timestampUs: toRelative(event.startUs, originUs),
    label: event.type,
    kind: event.type,
    id: event.id,
  }));
}

export function cueMarkers(cues: CueEvent[] | undefined, originUs: number): TimelineMarker[] {
  return (cues ?? []).map((cue) => ({
    timestampUs: toRelative(cue.timestampUs, originUs),
    label: cue.kind,
    kind: "cue",
    id: cue.id,
  }));
}

export function noteAllowedSegments(
  drill: DrillDefinition | undefined,
  durationUs: number,
): TimelineSegment[] {
  if (!drill?.noteAllowedIntervals.length) return [];
  return drill.noteAllowedIntervals.map((interval, index) => ({
    startUs: Math.round(interval.startSec * 1_000_000),
    endUs: Math.min(durationUs, Math.round(interval.endSec * 1_000_000)),
    label: interval.label ?? `notes-${index + 1}`,
    kind: "note_allowed",
  }));
}

export function speakingSegments(windows: SpeakingWindow[] | undefined, originUs: number): TimelineSegment[] {
  return (windows ?? []).map((window, index) => ({
    startUs: toRelative(window.startUs, originUs),
    endUs: toRelative(window.endUs, originUs),
    label: `speech-${index + 1}`,
    kind: "speaking",
  }));
}

export function sentenceMarkers(
  sentences: SentenceBoundary[] | undefined,
): TimelineMarker[] {
  return (sentences ?? []).flatMap((sentence) => [
    {
      timestampUs: sentence.startUs,
      label: `sentence-start-${sentence.index}`,
      kind: "sentence_boundary",
      id: `s-start-${sentence.index}`,
    },
    {
      timestampUs: sentence.endUs,
      label: `sentence-end-${sentence.index}`,
      kind: "sentence_boundary",
      id: `s-end-${sentence.index}`,
    },
  ]);
}

export function bookmarkMarkers(
  bookmarks: ReviewBookmark[] | undefined,
): TimelineMarker[] {
  return (bookmarks ?? []).map((bookmark) => ({
    timestampUs: bookmark.timestampUs,
    label: bookmark.note,
    kind: "bookmark",
    id: bookmark.id,
  }));
}

/** Multi-lane review timeline used by the Review UI. */
export function buildReviewLanes(input: ReviewTimelineInput): ReviewLane[] {
  const durationUs = clampDuration(input.durationUs);
  const sentences =
    input.sentences ??
    stubTranscript().sentences;

  return [
    {
      id: "contact",
      name: "Contact state",
      segments: contactStateSegments(input.predictions, input.originUs, durationUs),
      markers: [],
    },
    {
      id: "events",
      name: "Breaks / recoveries",
      segments: [],
      markers: eventMarkers(input.events, input.originUs),
    },
    {
      id: "cues",
      name: "Cue markers",
      segments: [],
      markers: cueMarkers(input.cues, input.originUs),
    },
    {
      id: "notes",
      name: "Prompts / note-allowed",
      segments: noteAllowedSegments(input.drill, durationUs),
      markers: [],
    },
    {
      id: "speaking",
      name: "Speaking",
      segments: speakingSegments(input.speakingWindows, input.originUs),
      markers: [],
    },
    {
      id: "transcript",
      name: "Transcript / sentences",
      segments: [],
      markers: sentenceMarkers(sentences),
    },
    {
      id: "bookmarks",
      name: "Bookmarks",
      segments: [],
      markers: bookmarkMarkers(input.bookmarks),
    },
  ];
}

export const REVIEW_TIMELINE_ZOOM_LEVELS = [1, 2, 4, 8] as const;
export type ReviewTimelineZoom =
  (typeof REVIEW_TIMELINE_ZOOM_LEVELS)[number];

export interface TimelineViewport {
  startUs: number;
  endUs: number;
  durationUs: number;
}

/** Center a zoomed viewport on playback while clamping to session bounds. */
export function timelineViewport(
  totalDurationUs: number,
  zoom: ReviewTimelineZoom,
  focusUs: number,
): TimelineViewport {
  const total = clampDuration(totalDurationUs);
  const durationUs = Math.max(1, total / zoom);
  const maxStart = Math.max(0, total - durationUs);
  const startUs = Math.min(
    maxStart,
    Math.max(0, focusUs - durationUs / 2),
  );
  return {
    startUs,
    endUs: startUs + durationUs,
    durationUs,
  };
}

export function timestampPercentInViewport(
  timestampUs: number,
  viewport: TimelineViewport,
): number | undefined {
  if (timestampUs < viewport.startUs || timestampUs > viewport.endUs) {
    return undefined;
  }
  return ((timestampUs - viewport.startUs) / viewport.durationUs) * 100;
}

export function segmentPercentInViewport(
  segment: Pick<TimelineSegment, "startUs" | "endUs">,
  viewport: TimelineViewport,
): { leftPct: number; widthPct: number } | undefined {
  const startUs = Math.max(segment.startUs, viewport.startUs);
  const endUs = Math.min(segment.endUs, viewport.endUs);
  if (endUs <= startUs) return undefined;
  return {
    leftPct: ((startUs - viewport.startUs) / viewport.durationUs) * 100,
    widthPct: ((endUs - startUs) / viewport.durationUs) * 100,
  };
}

export function keyboardSeekSeconds(args: {
  key: string;
  currentSeconds: number;
  durationSeconds: number;
  shiftKey?: boolean;
}): number | undefined {
  const step = args.shiftKey ? 5 : 1;
  let target: number;
  switch (args.key) {
    case "ArrowLeft":
      target = args.currentSeconds - step;
      break;
    case "ArrowRight":
      target = args.currentSeconds + step;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = args.durationSeconds;
      break;
    default:
      return undefined;
  }
  return Math.min(args.durationSeconds, Math.max(0, target));
}

/** Seek helper: convert a timeline marker/segment time to media seconds. */
export function seekSecondsFromTimelineUs(timestampUs: number): number {
  return Math.max(0, timestampUs / 1_000_000);
}

export function isExcludedFromMetrics(
  timestampUs: number,
  exclusions: MetricExclusionWindow[] | undefined,
): boolean {
  if (!exclusions?.length) return false;
  return exclusions.some(
    (window) => timestampUs >= window.startUs && timestampUs < window.endUs,
  );
}

/**
 * Filter predictions for coaching metrics: drop unknown, exclusions, and
 * optional note-allowed intervals when requested.
 */
export function predictionsForCoachingMetrics(
  predictions: GazePrediction[],
  options: {
    originUs: number;
    exclusions?: MetricExclusionWindow[];
    dropUnknown?: boolean;
  },
): GazePrediction[] {
  const dropUnknown = options.dropUnknown ?? true;
  return predictions.filter((prediction) => {
    if (dropUnknown && prediction.state === "unknown") return false;
    const relative = toRelative(prediction.timestampUs, options.originUs);
    if (isExcludedFromMetrics(relative, options.exclusions)) return false;
    return true;
  });
}

export interface SessionReport {
  format: "camera-presence-session-report/1.0.0";
  generatedAt: string;
  manifest: SessionManifest;
  summary: {
    frameCount: number;
    cueCount: number;
    breakCount: number;
    recoveryCount: number;
    speakingSeconds: number;
    bookmarkCount: number;
    contactRatio?: number;
    drillId?: string;
    feedbackIntensity?: string;
  };
  lanes: ReviewLane[];
  markdown: string;
}

export function buildSessionReport(args: {
  manifest: SessionManifest;
  predictions: GazePrediction[];
  events: GazeEvent[];
  cues?: CueEvent[];
  drill?: DrillDefinition;
  originUs: number;
  durationUs: number;
  speakingWindows?: SpeakingWindow[];
  sentences?: SentenceBoundary[];
  bookmarks?: ReviewBookmark[];
  exclusions?: MetricExclusionWindow[];
}): SessionReport {
  const lanes = buildReviewLanes({
    originUs: args.originUs,
    durationUs: args.durationUs,
    predictions: args.predictions,
    events: args.events,
    cues: args.cues,
    drill: args.drill,
    speakingWindows: args.speakingWindows,
    sentences: args.sentences,
    bookmarks: args.bookmarks,
    exclusions: args.exclusions,
  });
  const scored = predictionsForCoachingMetrics(args.predictions, {
    originUs: args.originUs,
    exclusions: args.exclusions,
  });
  const contactFrames = scored.filter((prediction) => prediction.state === "contact").length;
  const contactRatio = scored.length ? contactFrames / scored.length : undefined;
  const breakCount = args.events.filter((event) => event.type === "break").length;
  const recoveryCount = args.events.filter((event) => event.type === "recovery").length;
  const cueCount = args.cues?.length ?? 0;
  const spokenSeconds = speakingSeconds(args.speakingWindows ?? []);
  const bookmarkCount = args.bookmarks?.length ?? 0;
  const markdown = [
    `# Session report`,
    ``,
    `- Session: \`${args.manifest.id}\``,
    `- Profile: \`${args.manifest.profileId}\``,
    `- Status: ${args.manifest.status}`,
    `- Drill: ${args.manifest.coaching?.drillId ?? "none"} v${args.manifest.coaching?.drillVersion ?? "—"}`,
    `- Feedback: ${args.manifest.coaching?.feedbackIntensity ?? "—"}`,
    `- Frames: ${args.manifest.frameCount}`,
    `- Contact ratio (scored): ${contactRatio === undefined ? "n/a" : (contactRatio * 100).toFixed(1) + "%"}`,
    `- Breaks: ${breakCount}`,
    `- Recoveries: ${recoveryCount}`,
    `- Cues: ${cueCount}`,
    `- Speaking: ${spokenSeconds.toFixed(1)}s`,
    `- Bookmarks: ${bookmarkCount}`,
    ``,
    `## Lanes`,
    ...lanes.map(
      (lane) =>
        `- **${lane.name}**: ${lane.segments.length} segments, ${lane.markers.length} markers`,
    ),
  ].join("\n");

  return {
    format: "camera-presence-session-report/1.0.0",
    generatedAt: new Date().toISOString(),
    manifest: args.manifest,
    summary: {
      frameCount: args.manifest.frameCount,
      cueCount,
      breakCount,
      recoveryCount,
      speakingSeconds: spokenSeconds,
      bookmarkCount,
      contactRatio,
      drillId: args.manifest.coaching?.drillId,
      feedbackIntensity: args.manifest.coaching?.feedbackIntensity,
    },
    lanes,
    markdown,
  };
}

export function contactColor(state: GazeState | string): string {
  switch (state) {
    case "contact":
      return "#7ee2b8";
    case "near_lens":
      return "#e8c86b";
    case "off_lens":
      return "#df826f";
    default:
      return "#8d9f99";
  }
}
