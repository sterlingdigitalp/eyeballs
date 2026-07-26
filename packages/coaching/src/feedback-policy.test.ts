import { describe, expect, it } from "vitest";
import type { DrillDefinition, GazePrediction } from "../../contracts/src";
import { parseDrillDefinition } from "./drills";
import {
  FeedbackPolicyEngine,
  noteWindowsFromDrill,
} from "./feedback-policy";
import level1 from "../content/drills/level1-relaxed-lens-hold.json";
import level4 from "../content/drills/level4-presentation-rehearsal.json";
import level5 from "../content/drills/level5-simulated-livestream.json";

const prediction = (
  overrides: Partial<GazePrediction> & Pick<GazePrediction, "timestampUs" | "state">,
): GazePrediction => ({
  confidence: 0.9,
  classProbabilities: {
    contact: overrides.state === "contact" ? 0.9 : 0.05,
    near_lens: overrides.state === "near_lens" ? 0.9 : 0.05,
    off_lens: overrides.state === "off_lens" ? 0.9 : 0.05,
    unknown: overrides.state === "unknown" ? 0.9 : 0.05,
  },
  rawState: overrides.state,
  blinkSuppressed: false,
  calibrationId: "cal",
  trackerId: "tracker",
  trackerVersion: "1",
  algorithmVersion: "algo",
  ...overrides,
});

function engineFor(drill: DrillDefinition, intensity?: DrillDefinition["contactPolicy"]["feedbackLevel"]) {
  return new FeedbackPolicyEngine({ drill, intensity });
}

describe("feedback policy engine", () => {
  const comfort = parseDrillDefinition(level1);
  const rehearsal = parseDrillDefinition(level4);
  const livestream = parseDrillDefinition(level5);

  it("does not cue below reportable break threshold", () => {
    const engine = engineFor(comfort, "standard");
    const cue = engine.evaluate({
      prediction: prediction({ timestampUs: 2_000_000, state: "off_lens" }),
      openBreakDurationMs: comfort.contactPolicy.reportableBreakMinMs - 100,
      recoveryJustOccurred: false,
      speaking: true,
    });
    expect(cue).toBeUndefined();
    expect(engine.cueLog).toHaveLength(0);
  });

  it("suppresses cues during blink", () => {
    const engine = engineFor(comfort, "standard");
    const cue = engine.evaluate({
      prediction: prediction({
        timestampUs: 3_000_000,
        state: "off_lens",
        blinkSuppressed: true,
      }),
      openBreakDurationMs: 5_000,
      recoveryJustOccurred: false,
      speaking: true,
      blink: true,
    });
    expect(cue).toBeUndefined();
  });

  it("suppresses cues during unknown tracking", () => {
    const engine = engineFor(comfort, "standard");
    const cue = engine.evaluate({
      prediction: prediction({ timestampUs: 3_000_000, state: "unknown" }),
      openBreakDurationMs: 5_000,
      recoveryJustOccurred: false,
      speaking: true,
    });
    expect(cue).toBeUndefined();
  });

  it("emits a cue after threshold with evidence, then cooldown suppresses repeats", () => {
    const engine = engineFor(comfort, "standard");
    const first = engine.evaluate({
      prediction: prediction({ timestampUs: 5_000_000, state: "off_lens" }),
      openBreakDurationMs: comfort.contactPolicy.reportableBreakMinMs + 200,
      recoveryJustOccurred: false,
      speaking: true,
    });
    expect(first).toBeDefined();
    expect(first!.kind).toMatch(/halo|pulse/);
    expect(first!.evidence.length).toBeGreaterThan(0);
    expect(first!.evidence.some((item) => item.startsWith("break_ms="))).toBe(true);
    expect(first!.evidence.some((item) => item.startsWith("threshold_ms="))).toBe(true);
    expect(first!.drillId).toBe(comfort.id);

    const duringCooldown = engine.evaluate({
      prediction: prediction({
        timestampUs:
          5_000_000 + (comfort.contactPolicy.feedbackCooldownMs - 100) * 1000,
        state: "off_lens",
      }),
      openBreakDurationMs: comfort.contactPolicy.reportableBreakMinMs + 500,
      recoveryJustOccurred: false,
      speaking: true,
    });
    expect(duringCooldown).toBeUndefined();
    expect(engine.cueLog).toHaveLength(1);

    const afterCooldown = engine.evaluate({
      prediction: prediction({
        timestampUs:
          5_000_000 + (comfort.contactPolicy.feedbackCooldownMs + 50) * 1000,
        state: "off_lens",
      }),
      openBreakDurationMs: comfort.contactPolicy.reportableBreakMinMs + 800,
      recoveryJustOccurred: false,
      speaking: true,
    });
    expect(afterCooldown).toBeDefined();
    expect(engine.cueLog).toHaveLength(2);
  });

  it("uses a more lenient threshold inside note-allowed windows", () => {
    const engine = engineFor(rehearsal, "standard");
    const windows = noteWindowsFromDrill(rehearsal, 0);
    expect(windows.length).toBeGreaterThan(0);
    const inNotes = windows[0];
    const midUs = Math.floor((inNotes.startUs + inNotes.endUs) / 2);
    const standardThreshold = rehearsal.contactPolicy.reportableBreakMinMs;
    const noteThreshold =
      rehearsal.contactPolicy.noteAllowedNearLensMs ?? standardThreshold * 2;

    const belowNoteThreshold = engine.evaluate({
      prediction: prediction({ timestampUs: midUs, state: "off_lens" }),
      openBreakDurationMs: standardThreshold + 50,
      recoveryJustOccurred: false,
      speaking: true,
      sessionRelativeUs: midUs,
      noteAllowedWindows: windows,
    });
    expect(belowNoteThreshold).toBeUndefined();

    const aboveNoteThreshold = engine.evaluate({
      prediction: prediction({ timestampUs: midUs + 1_000, state: "off_lens" }),
      openBreakDurationMs: noteThreshold + 100,
      recoveryJustOccurred: false,
      speaking: true,
      sessionRelativeUs: midUs + 1_000,
      noteAllowedWindows: windows,
    });
    expect(aboveNoteThreshold).toBeDefined();
    expect(aboveNoteThreshold!.evidence).toContain("note_allowed_window");
  });

  it("acknowledges recovery once under active intensity", () => {
    const engine = engineFor(livestream, "active");
    engine.observeEvents([
      {
        id: "b1",
        type: "break",
        startUs: 1_000_000,
        endUs: 2_500_000,
        confidence: 0.9,
      },
      {
        id: "r1",
        type: "recovery",
        startUs: 2_500_000,
        endUs: 2_500_000,
        confidence: 0.9,
      },
    ]);
    const ack = engine.evaluate({
      prediction: prediction({ timestampUs: 2_500_000, state: "contact" }),
      openBreakDurationMs: 0,
      recoveryJustOccurred: true,
      speaking: true,
    });
    expect(ack?.kind).toBe("recovery_ack");
    expect(ack?.evidence).toContain("recovery_confirmed");

    const second = engine.evaluate({
      prediction: prediction({ timestampUs: 2_600_000, state: "contact" }),
      openBreakDurationMs: 0,
      recoveryJustOccurred: true,
      speaking: true,
    });
    expect(second).toBeUndefined();
  });

  it("stores user ratings on cues", () => {
    const engine = engineFor(comfort, "standard");
    const cue = engine.evaluate({
      prediction: prediction({ timestampUs: 8_000_000, state: "off_lens" }),
      openBreakDurationMs: comfort.contactPolicy.reportableBreakMinMs + 300,
      recoveryJustOccurred: false,
      speaking: false,
    });
    expect(cue).toBeDefined();
    const rated = engine.rateCue(cue!.id, "unnecessary");
    expect(rated?.rating).toBe("unnecessary");
    expect(engine.cueLog[0].rating).toBe("unnecessary");
    expect(engine.rateCue("missing", "helpful")).toBeUndefined();
  });

  it("emits no live cues in review_only or off modes", () => {
    for (const intensity of ["off", "review_only"] as const) {
      const engine = engineFor(comfort, intensity);
      const cue = engine.evaluate({
        prediction: prediction({ timestampUs: 9_000_000, state: "off_lens" }),
        openBreakDurationMs: 10_000,
        recoveryJustOccurred: false,
        speaking: true,
      });
      expect(cue).toBeUndefined();
    }
  });
});
