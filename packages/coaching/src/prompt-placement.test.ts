import { describe, expect, it } from "vitest";
import { drillFromOutline, parseDrillDefinition } from "./drills";
import {
  placeLensAdjacentPrompt,
  promptRegionStyle,
  resolvePromptReveal,
} from "./prompt-placement";
import level2 from "../content/drills/level2-lens-adjacent-reading.json";
import level3 from "../content/drills/level3-prompted-response.json";

describe("lens-adjacent prompt placement", () => {
  it("constrains the prompt region near the lens anchor", () => {
    const region = placeLensAdjacentPrompt({ anchor: { x: 0.5, y: 0.08 } });
    expect(region.top).toBeGreaterThan(0.08);
    expect(region.maxWidth).toBeLessThanOrEqual(0.42);
    expect(region.left).toBeGreaterThanOrEqual(0);
    expect(region.left + region.maxWidth).toBeLessThanOrEqual(1);
    const style = promptRegionStyle(region);
    expect(style.left).toMatch(/%$/);
    expect(style.fontSize).toMatch(/rem$/);
  });

  it("keeps large-text mode lens-proximal without centering the full screen", () => {
    const region = placeLensAdjacentPrompt({
      anchor: { x: 0.12, y: 0.1 },
      largeText: true,
    });
    expect(region.fontScale).toBeGreaterThan(1);
    expect(region.left).toBeLessThan(0.3);
    expect(region.maxWidth).toBeLessThanOrEqual(0.55);
  });
});

describe("prompt reveal modes", () => {
  const reading = parseDrillDefinition(level2);
  const prompted = parseDrillDefinition(level3);

  it("reveals one phrase at a time", () => {
    const early = resolvePromptReveal({
      drill: reading,
      elapsedSec: 1,
      speaking: false,
    });
    expect(early.mode).toBe("phrase_by_phrase");
    expect(early.hidden).toBe(false);
    expect(early.visibleText).toBe(reading.prompt.phrases![0]);

    const later = resolvePromptReveal({
      drill: reading,
      elapsedSec: 9,
      speaking: false,
    });
    expect(later.phraseIndex).toBeGreaterThan(0);
    expect(later.visibleText).toBe(reading.prompt.phrases![later.phraseIndex]);
  });

  it("hides prompt while speaking when hide-on-speech is enabled", () => {
    const shown = resolvePromptReveal({
      drill: prompted,
      elapsedSec: 6,
      speaking: false,
    });
    expect(shown.hidden).toBe(false);
    expect(shown.visibleText.length).toBeGreaterThan(0);

    const hidden = resolvePromptReveal({
      drill: prompted,
      elapsedSec: 6,
      speaking: true,
    });
    expect(hidden.hidden).toBe(true);
  });

  it("uses explicit per-beat start times for custom rehearsal outlines", () => {
    const custom = drillFromOutline(
      "- Opening\n- Evidence\n- Close",
      {
        durationTargetSec: 60,
        phraseStartSec: [0, 12, 45],
      },
    );

    expect(
      resolvePromptReveal({
        drill: custom,
        elapsedSec: 11.9,
        speaking: false,
      }).visibleText,
    ).toBe("Opening");
    expect(
      resolvePromptReveal({
        drill: custom,
        elapsedSec: 12,
        speaking: false,
      }).visibleText,
    ).toBe("Evidence");
    expect(
      resolvePromptReveal({
        drill: custom,
        elapsedSec: 50,
        speaking: false,
      }).visibleText,
    ).toBe("Close");
  });
});
