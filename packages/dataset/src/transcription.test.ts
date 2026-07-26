import { describe, expect, it } from "vitest";
import { stubTranscript } from "../../coaching/src/speaking";
import {
  applyTranscriptCorrections,
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

  it("does not make live coaching modules await ASR workers", () => {
    expect(liveCoachingMustNotAwaitAsr()).toBe(true);
    // materializeTranscript is dataset-side; live path uses stubTranscript only
    const stub = stubTranscript("live_path");
    expect(stub.words).toEqual([]);
  });
});
