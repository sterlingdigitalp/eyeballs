import { describe, expect, it } from "vitest";
import { stubTranscript } from "../../coaching/src/speaking";
import {
  applyTranscriptCorrections,
  applySentenceBoundaryCorrections,
  liveCoachingMustNotAwaitAsr,
  materializeTranscript,
} from "./transcription";

describe("transcription materialization", () => {
  it("builds word/sentence structures from worker output and keeps corrections separate", () => {
    const doc = materializeTranscript("s1", {
      status: "succeeded",
      modelVersion: "mlx-whisper/test",
      words: [
        { text: "Hello", startUs: 0, endUs: 200_000 },
        { text: "world.", startUs: 200_000, endUs: 400_000 },
      ],
    });
    expect(doc.origin).toBe("model");
    expect(doc.sentences).toHaveLength(1);
    expect(doc.sentences[0].text).toContain("Hello");

    const { original, corrected } = applyTranscriptCorrections(doc, [
      { text: "Hello", startUs: 0, endUs: 200_000 },
      { text: "team.", startUs: 200_000, endUs: 400_000 },
    ]);
    expect(original.origin).toBe("model");
    expect(original.words[1].text).toBe("world.");
    expect(corrected.origin).toBe("user_corrected");
    expect(corrected.sentences[0].text).toContain("team");
  });

  it("preserves stub path when worker is absent without throwing", () => {
    const doc = materializeTranscript("s2", { status: "absent" });
    expect(doc.origin).toBe("stub");
    expect(doc.stubReason).toBeTruthy();
    expect(doc.words).toEqual([]);
    // Coaching speaking helper still provides stubs independently of workers
    expect(stubTranscript().stubReason).toBe("asr_not_integrated");
  });

  it("preserves original words while correcting ordered sentence boundaries", () => {
    const doc = materializeTranscript("s3", {
      status: "succeeded",
      words: [
        { text: "One", startUs: 0, endUs: 200_000 },
        { text: "two.", startUs: 200_000, endUs: 400_000 },
      ],
    });
    const { original, corrected } = applySentenceBoundaryCorrections(doc, [
      { index: 9, startUs: 600_000, endUs: 900_000, text: "Second." },
      { index: 4, startUs: 0, endUs: 500_000, text: "First." },
    ]);
    expect(original).toBe(doc);
    expect(original.sentences[0].text).toContain("One");
    expect(corrected.words).toEqual(doc.words);
    expect(corrected.sentences.map((sentence) => sentence.index)).toEqual([0, 1]);
    expect(corrected.sentences.map((sentence) => sentence.text)).toEqual([
      "First.",
      "Second.",
    ]);
  });

  it("rejects overlapping sentence corrections", () => {
    const doc = materializeTranscript("s4", { status: "absent" });
    expect(() =>
      applySentenceBoundaryCorrections(doc, [
        { index: 0, startUs: 0, endUs: 500_000, text: "First." },
        { index: 1, startUs: 400_000, endUs: 800_000, text: "Overlap." },
      ]),
    ).toThrow(/overlap/);
  });

  it("does not make live coaching modules await ASR workers", () => {
    expect(liveCoachingMustNotAwaitAsr()).toBe(true);
    // materializeTranscript is dataset-side; live path uses stubTranscript only
    const stub = stubTranscript("live_path");
    expect(stub.words).toEqual([]);
  });
});
