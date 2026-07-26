import { describe, expect, it } from "vitest";
import type { CueEvent, GazeEvent, GazePrediction, SessionManifest } from "../../contracts/src";
import { parseDrillDefinition } from "./drills";
import {
  buildReviewLanes,
  buildSessionReport,
  keyboardSeekSeconds,
  isExcludedFromMetrics,
  predictionsForCoachingMetrics,
  segmentPercentInViewport,
  seekSecondsFromTimelineUs,
  timelineViewport,
  timestampPercentInViewport,
} from "./review-timeline";
import level4 from "../content/drills/level4-presentation-rehearsal.json";

const prediction = (
  timestampUs: number,
  state: GazePrediction["state"],
): GazePrediction => ({
  timestampUs,
  state,
  confidence: 0.9,
  rawState: state,
  blinkSuppressed: false,
  calibrationId: "c",
  trackerId: "t",
  trackerVersion: "1",
  algorithmVersion: "a",
});

const manifest = (): SessionManifest => ({
  schemaVersion: "1.0.0",
  id: "session-report-1",
  profileId: "profile-1",
  calibrationId: "cal-1",
  trackerId: "t",
  trackerVersion: "1",
  algorithmVersion: "a",
  startedAt: "2026-07-25T12:00:00.000Z",
  monotonicStartUs: 1_000_000,
  status: "complete",
  frameCount: 4,
  droppedFrameCount: 0,
  coaching: {
    drillId: "presentation-rehearsal-01",
    drillVersion: "1",
    curriculumLevel: 4,
    feedbackIntensity: "standard",
    scoringPolicyVersion: "coaching-scoring/1.0.0",
  },
});

describe("review timeline", () => {
  const originUs = 1_000_000;
  const predictions = [
    prediction(1_000_000, "contact"),
    prediction(1_500_000, "off_lens"),
    prediction(2_000_000, "unknown"),
    prediction(2_500_000, "contact"),
  ];
  const events: GazeEvent[] = [
    { id: "b1", type: "break", startUs: 1_500_000, endUs: 2_000_000, confidence: 0.8 },
    { id: "r1", type: "recovery", startUs: 2_500_000, endUs: 2_500_000, confidence: 0.9 },
  ];
  const cues: CueEvent[] = [
    {
      id: "cue-1",
      kind: "halo",
      timestampUs: 1_800_000,
      evidence: ["break_ms=900", "threshold_ms=900"],
      drillId: "presentation-rehearsal-01",
    },
  ];
  const drill = parseDrillDefinition(level4);

  it("builds multi-lane timeline with contact, events, cues, and note-allowed", () => {
    const lanes = buildReviewLanes({
      originUs,
      durationUs: 3_000_000,
      predictions,
      events,
      cues,
      drill,
      speakingWindows: [{ startUs: 1_250_000, endUs: 2_250_000 }],
      sentences: [
        { index: 0, startUs: 100_000, endUs: 900_000, text: "Hello world." },
      ],
    });
    expect(lanes.map((lane) => lane.id)).toEqual([
      "contact",
      "events",
      "cues",
      "notes",
      "speaking",
      "transcript",
      "bookmarks",
      "clips",
    ]);
    const contact = lanes.find((lane) => lane.id === "contact")!;
    expect(contact.segments.some((segment) => segment.label === "contact")).toBe(true);
    expect(contact.segments.some((segment) => segment.label === "off_lens")).toBe(true);

    const cueLane = lanes.find((lane) => lane.id === "cues")!;
    expect(cueLane.markers).toHaveLength(1);
    expect(cueLane.markers[0].timestampUs).toBe(800_000);

    const notes = lanes.find((lane) => lane.id === "notes")!;
    expect(notes.segments.length).toBeGreaterThan(0);

    const speaking = lanes.find((lane) => lane.id === "speaking")!;
    expect(speaking.segments).toEqual([
      {
        startUs: 250_000,
        endUs: 1_250_000,
        label: "speech-1",
        kind: "speaking",
      },
    ]);

    const transcript = lanes.find((lane) => lane.id === "transcript")!;
    expect(transcript.markers.some((marker) => marker.kind === "sentence_boundary")).toBe(true);
  });

  it("seeks timeline microseconds to media seconds", () => {
    expect(seekSecondsFromTimelineUs(1_500_000)).toBe(1.5);
    expect(seekSecondsFromTimelineUs(-10)).toBe(0);
  });

  it("zooms around playback and maps only visible evidence", () => {
    const viewport = timelineViewport(8_000_000, 4, 4_000_000);
    expect(viewport).toEqual({
      startUs: 3_000_000,
      endUs: 5_000_000,
      durationUs: 2_000_000,
    });
    expect(timestampPercentInViewport(4_000_000, viewport)).toBe(50);
    expect(timestampPercentInViewport(2_000_000, viewport)).toBeUndefined();
    expect(
      segmentPercentInViewport(
        { startUs: 2_500_000, endUs: 3_500_000 },
        viewport,
      ),
    ).toEqual({ leftPct: 0, widthPct: 25 });
  });

  it("supports bounded one-second and shift-five-second keyboard seeking", () => {
    expect(
      keyboardSeekSeconds({
        key: "ArrowRight",
        currentSeconds: 2,
        durationSeconds: 10,
      }),
    ).toBe(3);
    expect(
      keyboardSeekSeconds({
        key: "ArrowLeft",
        currentSeconds: 2,
        durationSeconds: 10,
        shiftKey: true,
      }),
    ).toBe(0);
    expect(
      keyboardSeekSeconds({
        key: "End",
        currentSeconds: 2,
        durationSeconds: 10,
      }),
    ).toBe(10);
    expect(
      keyboardSeekSeconds({
        key: "Space",
        currentSeconds: 2,
        durationSeconds: 10,
      }),
    ).toBeUndefined();
  });

  it("excludes invalid intervals from coaching metric frames", () => {
    const exclusions = [{ startUs: 0, endUs: 600_000, reason: "countdown" }];
    expect(isExcludedFromMetrics(100_000, exclusions)).toBe(true);
    expect(isExcludedFromMetrics(700_000, exclusions)).toBe(false);
    const scored = predictionsForCoachingMetrics(predictions, {
      originUs,
      exclusions,
    });
    expect(scored.every((prediction) => prediction.state !== "unknown")).toBe(true);
    expect(scored.some((prediction) => prediction.timestampUs === 1_000_000)).toBe(false);
  });

  it("exports Markdown/JSON session report with summary evidence", () => {
    const report = buildSessionReport({
      manifest: manifest(),
      predictions,
      events,
      cues,
      drill,
      speakingWindows: [{ startUs: 1_250_000, endUs: 2_750_000 }],
      bookmarks: [
        {
          id: "bookmark-1",
          sessionId: "session-report-1",
          timestampUs: 500_000,
          note: "Strong recovery",
          createdAt: "2026-07-25T12:01:00.000Z",
        },
      ],
      reviewClips: [
        {
          id: "review-clip-1",
          sessionId: "session-report-1",
          startUs: 250_000,
          endUs: 750_000,
          note: "Strong opening",
          createdAt: "2026-07-25T12:01:00.000Z",
        },
      ],
      sentences: [
        { index: 0, startUs: 0, endUs: 500_000, text: "Opening." },
      ],
      originUs,
      durationUs: 3_000_000,
    });
    expect(report.format).toBe("camera-presence-session-report/1.0.0");
    expect(report.summary.cueCount).toBe(1);
    expect(report.summary.breakCount).toBe(1);
    expect(report.summary.speakingSeconds).toBe(1.5);
    expect(report.summary.bookmarkCount).toBe(1);
    expect(report.summary.sentenceCount).toBe(1);
    expect(report.summary.reviewClipCount).toBe(1);
    expect(report.summary.drillId).toBe("presentation-rehearsal-01");
    expect(report.markdown).toContain("# Session report");
    expect(report.markdown).toContain("Cues: 1");
    expect(report.markdown).toContain("Speaking: 1.5s");
    expect(report.markdown).toContain("Bookmarks: 1");
    expect(report.markdown).toContain("Sentences: 1");
    expect(report.markdown).toContain("Review clips: 1");
    expect(report.lanes.length).toBe(8);
  });
});
