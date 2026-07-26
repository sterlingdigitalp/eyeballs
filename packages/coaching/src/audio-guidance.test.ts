import { describe, expect, it } from "vitest";
import { parseDrillDefinition } from "./drills";
import {
  COACHING_TONE_PATTERNS,
  HANDS_FREE_SETTLE_SECONDS,
  handsFreeInstruction,
  shouldAutoCompleteHandsFreeDrill,
} from "./audio-guidance";
import level1 from "../content/drills/level1-relaxed-lens-hold.json";
import level6 from "../content/drills/level6-live-assist.json";

describe("hands-free coaching audio", () => {
  const lensHold = parseDrillDefinition(level1);
  const liveAssist = parseDrillDefinition(level6);

  it("announces the drill, physical lens target, and start-tone contract", () => {
    const instruction = handsFreeInstruction(lensHold);
    expect(instruction).toContain(lensHold.name);
    expect(instruction).toContain(lensHold.prompt.text);
    expect(instruction).toContain("camera lens");
    expect(instruction).toContain("start tone");
    expect(HANDS_FREE_SETTLE_SECONDS).toBeGreaterThanOrEqual(3);
  });

  it("uses distinct settle, start, and completion signals", () => {
    expect(COACHING_TONE_PATTERNS.settle).not.toEqual(
      COACHING_TONE_PATTERNS.start,
    );
    expect(COACHING_TONE_PATTERNS.complete).toHaveLength(2);
  });

  it("auto-completes timed drills but leaves live assist open-ended", () => {
    expect(
      shouldAutoCompleteHandsFreeDrill(
        lensHold,
        lensHold.durationTargetSec - 1,
      ),
    ).toBe(false);
    expect(
      shouldAutoCompleteHandsFreeDrill(lensHold, lensHold.durationTargetSec),
    ).toBe(true);
    expect(shouldAutoCompleteHandsFreeDrill(liveAssist, 10_000)).toBe(false);
  });
});
