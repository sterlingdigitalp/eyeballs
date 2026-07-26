import { describe, expect, it } from "vitest";
import type { CueEvent, GazeEvent, GazePrediction, SessionManifest } from "../../contracts/src";
import { parseDrillDefinition } from "./drills";
import {
  buildReviewLanes,
  buildSessionReport,
  isExcludedFromMetrics,
  predictionsForCoachingMetrics,
  seekSecondsFromTimelineUs,
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
    ]);
    const contact = lanes.find((lane) => lane.id === "contact")!;
    expect(contact.segments.some((segment) => segment.label === "contact")).toBe(true);
    expect(contact.segments.some((segment) => segment.label === "off_lens")).toBe(true);

    const cueLane = lanes.find((lane) => lane.id === "cues")!;
    expect(cueLane.markers).toHaveLength(1);
    expect(cueLane.markers[0].timestampUs).toBe(800_000);

    const notes = lanes.find((lane) => lane.id === "notes")!;
    expect(notes.segments.length).toBeGreaterThan(0);

    const transcript = lanes.find((lane) => lane.id === "transcript")!;
    expect(transcript.markers.some((marker) => marker.kind === "sentence_boundary")).toBe(true);
  });

  it("seeks timeline microseconds to media seconds", () => {
    expect(seekSecondsFromTimelineUs(1_500_000)).toBe(1.5);
    expect(seekSecondsFromTimelineUs(-10)).toBe(0);
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
      originUs,
      durationUs: 3_000_000,
    });
    expect(report.format).toBe("camera-presence-session-report/1.0.0");
    expect(report.summary.cueCount).toBe(1);
    expect(report.summary.breakCount).toBe(1);
    expect(report.summary.drillId).toBe("presentation-rehearsal-01");
    expect(report.markdown).toContain("# Session report");
    expect(report.markdown).toContain("Cues: 1");
    expect(report.lanes.length).toBe(6);
  });
});
