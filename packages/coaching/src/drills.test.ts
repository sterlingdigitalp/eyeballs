import { describe, expect, it, beforeEach } from "vitest";
import {
  assertCurriculumCoverage,
  drillFromOutline,
  drillsByCurriculumLevel,
  DrillValidationError,
  getDrillById,
  loadBuiltinDrills,
  parseDrillDefinition,
  reviseOutlineDrill,
  resetBuiltinDrillCache,
  SCORING_POLICY_VERSION,
  stampDrillOnSession,
  drillVersionString,
} from "./drills";
import type { SessionManifest } from "../../contracts/src";
import { curriculumLevels } from "../../contracts/src";
import level1 from "../content/drills/level1-relaxed-lens-hold.json";

const baseManifest = (): SessionManifest => ({
  schemaVersion: "1.0.0",
  id: "session-1",
  profileId: "profile-1",
  calibrationId: "cal-1",
  trackerId: "mediapipe-face-landmarker",
  trackerVersion: "0.10.22",
  algorithmVersion: "cluster-hysteresis/1.2.1",
  startedAt: "2026-07-25T12:00:00.000Z",
  monotonicStartUs: 1_000_000,
  status: "recording",
  frameCount: 0,
  droppedFrameCount: 0,
});

describe("drill content loading and validation", () => {
  beforeEach(() => {
    resetBuiltinDrillCache();
  });

  it("loads built-in drills from content with versions and all six curriculum levels", () => {
    const drills = loadBuiltinDrills();
    expect(drills).toHaveLength(10);
    assertCurriculumCoverage(drills);
    const byLevel = drillsByCurriculumLevel();
    for (const level of curriculumLevels) {
      expect(byLevel[level].length).toBeGreaterThanOrEqual(1);
      for (const drill of byLevel[level]) {
        expect(drill.id.length).toBeGreaterThan(0);
        expect(drillVersionString(drill.version).length).toBeGreaterThan(0);
        expect(drill.curriculumLevel).toBeGreaterThanOrEqual(1);
        expect(drill.curriculumLevel).toBeLessThanOrEqual(6);
      }
    }
    const lensHold = getDrillById("relaxed-lens-hold-01");
    expect(lensHold?.name).toBe("Relaxed lens hold");
    expect(lensHold?.mode).toBe("lens_comfort");
    expect(getDrillById("greeting-introduction-01")).toBeDefined();
    expect(getDrillById("finish-sentence-through-lens-01")).toBeDefined();
    expect(getDrillById("notes-and-recover-01")).toBeDefined();
    expect(getDrillById("review-only-rehearsal-01")).toBeDefined();
  });

  it("rejects invalid drill content with structured issues", () => {
    expect(() => parseDrillDefinition({})).toThrow(DrillValidationError);
    expect(() =>
      parseDrillDefinition({
        ...level1,
        id: "",
      }),
    ).toThrow(DrillValidationError);

    try {
      parseDrillDefinition({
        ...level1,
        contactPolicy: {
          ...level1.contactPolicy,
          longBreakMinMs: 100,
          reportableBreakMinMs: 900,
        },
      });
      expect.unreachable("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(DrillValidationError);
      const issues = (error as DrillValidationError).issues.join(" ");
      expect(issues).toMatch(/longBreakMinMs/i);
    }

    expect(() =>
      parseDrillDefinition({
        ...level1,
        mode: "live_assist",
        curriculumLevel: 1,
      }),
    ).toThrow(/mode does not match/i);
  });

  it("stamps drill id, version, and scoring policy onto a session manifest", () => {
    const drill = parseDrillDefinition(level1);
    const stamped = stampDrillOnSession(baseManifest(), drill, {
      feedbackIntensity: "minimal",
      sessionGoal: "Stay relaxed for 30 seconds",
      comfortBefore: 3,
    });
    expect(stamped.coaching).toEqual({
      drillId: "relaxed-lens-hold-01",
      drillVersion: "1",
      curriculumLevel: 1,
      feedbackIntensity: "minimal",
      scoringPolicyVersion: SCORING_POLICY_VERSION,
      drillSnapshot: drill,
      sessionGoal: "Stay relaxed for 30 seconds",
      comfortBefore: 3,
      liveAssist: false,
    });
    expect(stamped.id).toBe("session-1");
  });

  it("builds a presentation rehearsal drill from a Markdown outline", () => {
    const drill = drillFromOutline(
      `# Opening\n- Claim the problem\n- Share the fix\n- Invite the next step`,
      { id: "outline-test", name: "Outline test" },
    );
    expect(drill.id).toBe("outline-test");
    expect(drill.mode).toBe("presentation_rehearsal");
    expect(drill.prompt.phrases?.length).toBe(4);
    expect(drill.prompt.phrases?.[0]).toBe("Opening");
    const short = drillFromOutline("One beat", { durationTargetSec: 30 });
    expect(short.completion.minimumDurationSec).toBeLessThanOrEqual(30);
    expect(short.completion.minimumSpeakingSec).toBeLessThanOrEqual(30);
  });

  it("revises a custom outline without mutating a prior session snapshot", () => {
    const original = drillFromOutline("- Opening\n- Main point", {
      id: "custom-outline-stable",
      name: "Original name",
      durationTargetSec: 90,
    });
    const sessionSnapshot = structuredClone(original);
    const revised = reviseOutlineDrill(
      original,
      "- New opening\n- Updated evidence\n- Close",
      {
        name: "Revised name",
        durationTargetSec: 120,
        phraseStartSec: [0, 20, 70],
      },
    );

    expect(revised.id).toBe(original.id);
    expect(revised.version).toBe(2);
    expect(revised.name).toBe("Revised name");
    expect(revised.prompt.phrases).toEqual([
      "New opening",
      "Updated evidence",
      "Close",
    ]);
    expect(revised.durationTargetSec).toBe(120);
    expect(revised.prompt.phraseStartSec).toEqual([0, 20, 70]);
    expect(original).toEqual(sessionSnapshot);
    expect(original.prompt.phrases).toEqual(["Opening", "Main point"]);
  });

  it("rejects malformed or out-of-duration custom beat timing", () => {
    expect(() =>
      drillFromOutline("- Opening\n- Close", {
        durationTargetSec: 60,
        phraseStartSec: [0],
      }),
    ).toThrow(/one start time per phrase/);
    expect(() =>
      drillFromOutline("- Opening\n- Close", {
        durationTargetSec: 60,
        phraseStartSec: [0, 60],
      }),
    ).toThrow(/exceeds the drill duration/);
    expect(() =>
      drillFromOutline("- Opening\n- Close", {
        durationTargetSec: 60,
        phraseStartSec: [10, 20],
      }),
    ).toThrow(/first phrase must start at 0/);
  });

  it("fails curriculum coverage when a level is missing", () => {
    const onlyLevel1 = [parseDrillDefinition(level1)];
    expect(() => assertCurriculumCoverage(onlyLevel1)).toThrow(/Curriculum incomplete/);
  });
});
