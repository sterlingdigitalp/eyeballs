import { describe, expect, it } from "vitest";
import type { Correction, GazePrediction } from "../../contracts/src";
import {
  calculateEventTiming,
  calculateConfusionMatrix,
  effectiveLabelSegments,
  mergedLabeledDurationUs,
  sessionRelativeSecondsToUs,
} from "./evaluation";

const prediction = (timestampUs: number, state: GazePrediction["state"]): GazePrediction => ({
  timestampUs,
  state,
  rawState: state,
  confidence: 0.9,
  blinkSuppressed: false,
  calibrationId: "cal",
  trackerId: "tracker",
  trackerVersion: "1",
  algorithmVersion: "1",
});

const correction = (startUs: number, endUs: number, label: Correction["label"]): Correction => ({
  id: crypto.randomUUID(),
  sessionId: "session",
  startUs,
  endUs,
  label,
  createdAt: new Date(0).toISOString(),
});

describe("ground-truth metrics", () => {
  it("counts unknown predictions against known labels and reports decision coverage", () => {
    const result = calculateConfusionMatrix(
      [
        prediction(0, "contact"),
        prediction(10_000_000, "off_lens"),
        prediction(20_000_000, "unknown"),
        prediction(30_000_000, "off_lens"),
        prediction(60_000_000, "contact"),
      ],
      [correction(0, 30_000_000, "contact"), correction(30_000_000, 70_000_000, "not_contact")],
    );
    expect(result.trueContact).toBe(1);
    expect(result.falseNotContact).toBe(1);
    expect(result.trueNotContact).toBe(1);
    expect(result.falseContact).toBe(1);
    expect(result.unknown).toBe(1);
    expect(result.agreement).toBe(0.4);
    expect(result.decisionCoverage).toBe(0.8);
  });

  it("uses half-open intervals and lets the newest overlapping correction win", () => {
    const first = correction(0, 20, "contact");
    const replacement = {
      ...correction(10, 30, "not_contact"),
      createdAt: new Date(1).toISOString(),
    };
    const result = calculateConfusionMatrix(
      [
        prediction(9, "contact"),
        prediction(10, "off_lens"),
        prediction(20, "off_lens"),
        prediction(30, "contact"),
      ],
      [first, replacement],
    );
    expect(result.trueContact).toBe(1);
    expect(result.trueNotContact).toBe(2);
    expect(result.falseContact).toBe(0);
    expect(result.falseNotContact).toBe(0);
    expect(effectiveLabelSegments([first, replacement])).toEqual([
      { startUs: 0, endUs: 10, label: "contact" },
      { startUs: 10, endUs: 30, label: "not_contact" },
    ]);
  });

  it("reports break-onset and recovery timing against effective labels", () => {
    const result = calculateEventTiming(
      [
        prediction(0, "contact"),
        prediction(1_600_000, "off_lens"),
        prediction(2_000_000, "off_lens"),
        prediction(3_250_000, "near_lens"),
      ],
      [
        correction(0, 1_000_000, "contact"),
        correction(1_000_000, 3_000_000, "not_contact"),
        correction(3_000_000, 4_000_000, "contact"),
      ],
    );
    expect(result.breaksDetected).toBe(1);
    expect(result.medianBreakOnsetMs).toBe(600);
    expect(result.recoveriesDetected).toBe(1);
    expect(result.medianRecoveryMs).toBe(250);
  });

  it("counts missed break and recovery transitions", () => {
    const result = calculateEventTiming(
      [prediction(0, "contact"), prediction(3_500_000, "off_lens")],
      [
        correction(0, 1_000_000, "contact"),
        correction(1_000_000, 3_000_000, "not_contact"),
        correction(3_000_000, 4_000_000, "contact"),
      ],
    );
    expect(result.missedBreaks).toBe(1);
    expect(result.missedRecoveries).toBe(1);
    expect(result.medianBreakOnsetMs).toBeNull();
  });

  it("does not let human-unknown intervals dilute the false-cue rate", () => {
    const result = calculateConfusionMatrix(
      [
        prediction(0, "contact"),
        prediction(1_000_000, "off_lens"),
        prediction(2_000_000, "contact"),
      ],
      [
        correction(0, 60_000_000, "contact"),
        correction(60_000_000, 120_000_000, "unknown"),
      ],
    );
    expect(result.labeledDurationUs).toBe(60_000_000);
    expect(result.falseCueRatePerMinute).toBe(1);
  });

  it("subtracts a newer human-unknown override from known labeled duration", () => {
    const result = calculateConfusionMatrix(
      [
        prediction(0, "contact"),
        prediction(10_000_000, "off_lens"),
        prediction(30_000_000, "off_lens"),
      ],
      [
        correction(0, 60_000_000, "contact"),
        correction(20_000_000, 40_000_000, "unknown"),
      ],
    );
    expect(result.labeledDurationUs).toBe(40_000_000);
  });

  it("converts review seconds onto the session monotonic time base", () => {
    expect(sessionRelativeSecondsToUs(500_000_000, 1.25)).toBe(501_250_000);
    expect(() => sessionRelativeSecondsToUs(0, -1)).toThrow(/non-negative/);
    expect(() => sessionRelativeSecondsToUs(0, Number.NaN)).toThrow(/non-negative/);
  });

  it("counts the union of labeled intervals without including gaps or overlap twice", () => {
    expect(mergedLabeledDurationUs([
      correction(100, 200, "contact"),
      correction(150, 250, "contact"),
      correction(500, 650, "not_contact"),
    ])).toBe(300);
  });

  it("calculates metrics when prediction timestamps have a non-zero session origin", () => {
    const startUs = 500_000_000;
    const result = calculateConfusionMatrix(
      [
        prediction(startUs, "contact"),
        prediction(startUs + 1_000_000, "off_lens"),
      ],
      [correction(
        sessionRelativeSecondsToUs(startUs, 0),
        sessionRelativeSecondsToUs(startUs, 2),
        "contact",
      )],
    );
    expect(result.trueContact).toBe(1);
    expect(result.falseNotContact).toBe(1);
    expect(result.labeledDurationUs).toBe(2_000_000);
  });
});
