import { describe, expect, it } from "vitest";
import { proposeSegments } from "./segmentation";

describe("segment proposals", () => {
  it("emits start/end ranges that point into master without media copy", () => {
    const proposals = proposeSegments({
      sessionId: "seg-1",
      durationUs: 30_000_000,
      sentences: [
        { index: 0, startUs: 1_000_000, endUs: 5_000_000, text: "One idea." },
        { index: 1, startUs: 6_000_000, endUs: 12_000_000, text: "Another point." },
      ],
    });
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    for (const proposal of proposals) {
      expect(proposal.endUs).toBeGreaterThan(proposal.startUs);
      expect(proposal.pointsIntoMaster).toBe(true);
      expect(proposal.reasons).toContain("points_into_master");
      expect(proposal.id).toContain("seg-1");
    }
  });

  it("falls back to speaking windows or grid when no sentences", () => {
    const fromSpeech = proposeSegments({
      sessionId: "seg-2",
      durationUs: 20_000_000,
      speakingWindows: [{ startUs: 0, endUs: 4_000_000 }],
    });
    expect(fromSpeech[0].band).toBe("fragment");
    const grid = proposeSegments({
      sessionId: "seg-3",
      durationUs: 30_000_000,
    });
    expect(grid.length).toBeGreaterThan(0);
  });

  it("rejects proposals that contain a long gaze break", () => {
    const proposals = proposeSegments({
      sessionId: "seg-break",
      durationUs: 20_000_000,
      sentences: [
        { index: 0, startUs: 1_000_000, endUs: 8_000_000, text: "Long break inside." },
      ],
      events: [
        {
          id: "b1",
          type: "break",
          startUs: 2_000_000,
          endUs: 6_000_000,
          confidence: 0.9,
        },
      ],
    });
    expect(proposals).toHaveLength(0);
  });
});
