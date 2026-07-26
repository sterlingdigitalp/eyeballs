import { describe, expect, it } from "vitest";
import { createHumanClip } from "./curation";
import { findNearDuplicates, usesIdentityEmbeddings } from "./duplicates";

describe("non-biometric duplicate detection", () => {
  it("flags transcript-similar and temporally overlapping pairs without identity embeddings", () => {
    expect(usesIdentityEmbeddings()).toBe(false);
    const a = createHumanClip("s1", 0, 5_000_000);
    const b = createHumanClip("s1", 1_000_000, 6_000_000);
    const c = createHumanClip("s2", 0, 5_000_000);
    const pairs = findNearDuplicates([
      {
        clip: a,
        transcriptText: "Explain one idea you care about in plain language",
        audioFingerprint: "fp-1",
        lookBackgroundKey: "navy|bookshelf",
      },
      {
        clip: b,
        transcriptText: "Explain one idea you care about in plain language today",
        audioFingerprint: "fp-1",
        lookBackgroundKey: "navy|bookshelf",
      },
      {
        clip: c,
        transcriptText: "Completely different content about weather",
        audioFingerprint: "fp-9",
      },
    ]);
    expect(pairs.length).toBeGreaterThan(0);
    const top = pairs[0];
    expect(top.leftId === a.id || top.rightId === a.id).toBe(true);
    expect(top.reasons.some((reason) => reason.includes("transcript") || reason.includes("overlap") || reason.includes("audio"))).toBe(true);
    expect(pairs.every((pair) => !pair.reasons.some((reason) => /identity|embedding/i.test(reason)))).toBe(true);
  });
});
