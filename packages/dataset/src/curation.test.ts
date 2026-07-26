import { describe, expect, it } from "vitest";
import {
  adjustClipBoundary,
  allClipLabels,
  applyCurationKey,
  curationReasonTags,
  createHumanClip,
  labelClip,
  toggleClipReasonTag,
} from "./curation";

describe("curation labels and boundaries", () => {
  it("accepts all five label values and adjusts boundaries", () => {
    expect(allClipLabels()).toEqual([
      "excellent",
      "usable",
      "coaching_only",
      "rejected",
      "delete",
    ]);
    let clip = createHumanClip("s", 1_000_000, 5_000_000);
    for (const label of allClipLabels()) {
      clip = labelClip(clip, label);
      expect(clip.label).toBe(label);
    }
    const adjusted = adjustClipBoundary(clip, 1_500_000, 4_500_000);
    expect(adjusted.startUs).toBe(1_500_000);
    expect(adjusted.endUs).toBe(4_500_000);
    expect(adjusted.pointsIntoMaster).toBe(true);
    expect(adjusted.proposedBy).toBe("human");
  });

  it("supports keyboard curation actions", () => {
    const clip = createHumanClip("s", 2_000_000, 6_000_000);
    const excellent = applyCurationKey(clip, "label_excellent");
    expect(excellent.label).toBe("excellent");
    const nudged = applyCurationKey(clip, "nudge_start_left", 200_000);
    expect(nudged.startUs).toBe(1_800_000);
  });

  it("adds and removes only recognized human curation reasons", () => {
    const clip = createHumanClip("s3", 0, 2_000_000);
    const tagged = toggleClipReasonTag(clip, "verbal_mistake");
    expect(tagged.reasonTags).toEqual(["verbal_mistake"]);
    expect(tagged.proposedBy).toBe("human");
    expect(toggleClipReasonTag(tagged, "verbal_mistake").reasonTags).toEqual([]);
    expect(curationReasonTags).toContain("privacy_sensitive");
    expect(() =>
      toggleClipReasonTag(clip, "made_up" as "verbal_mistake"),
    ).toThrow(/Invalid/);
  });

  it("rejects non-finite human clip boundaries", () => {
    expect(() => createHumanClip("s4", Number.NaN, 2_000_000)).toThrow(
      /Invalid range/,
    );
    expect(() =>
      adjustClipBoundary(
        createHumanClip("s4", 0, 2_000_000),
        0,
        Number.POSITIVE_INFINITY,
      ),
    ).toThrow(/finite integer/);
  });
});
