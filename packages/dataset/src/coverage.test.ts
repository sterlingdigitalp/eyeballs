import { describe, expect, it } from "vitest";
import { createHumanClip, labelClip } from "./curation";
import { buildCoverageReport, coverageDimensions } from "./coverage";

describe("coverage taxonomy", () => {
  it("reports missing, overrepresented, and fragile categories", () => {
    const base = labelClip(createHumanClip("s", 0, 2_000_000), "excellent");
    const items = [
      { clip: base, tags: ["neutral", "normal", "neutral_pose", "studio_capture"] },
      {
        clip: labelClip(createHumanClip("s", 2_000_000, 4_000_000), "usable"),
        tags: ["neutral", "normal", "neutral_pose", "studio_capture"],
      },
      {
        clip: labelClip(createHumanClip("s", 4_000_000, 6_000_000), "usable"),
        tags: ["neutral", "normal", "neutral_pose", "studio_capture"],
      },
      {
        clip: labelClip(createHumanClip("s", 6_000_000, 8_000_000), "usable"),
        tags: ["neutral", "normal", "neutral_pose", "studio_capture"],
      },
      {
        clip: labelClip(createHumanClip("s", 8_000_000, 10_000_000), "usable"),
        tags: ["neutral", "normal", "neutral_pose", "studio_capture"],
      },
      {
        clip: labelClip(createHumanClip("s", 10_000_000, 12_000_000), "excellent"),
        tags: ["persuasive"],
      },
    ];
    const report = buildCoverageReport(items, { overrepresentedThreshold: 5 });
    expect(report.missing).toContain("enthusiastic");
    expect(report.missing.length).toBeGreaterThan(0);
    expect(report.overrepresented).toContain("neutral");
    expect(report.fragile).toContain("persuasive");
    expect(coverageDimensions.deliveryStyle.length).toBeGreaterThan(5);
  });
});
