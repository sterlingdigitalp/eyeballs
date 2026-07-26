import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "../../contracts/src";
import { detectSpeechStructure } from "./speech-structure";

function word(text: string, startSeconds: number, endSeconds: number): TranscriptWord {
  return {
    text,
    startUs: startSeconds * 1_000_000,
    endUs: endSeconds * 1_000_000,
  };
}

describe("speech structure analysis", () => {
  it("marks a long pause and the unfinished fragment before it", () => {
    const analysis = detectSpeechStructure("speech-1", [
      word("I", 0, 0.2),
      word("think", 0.25, 0.6),
      word("Actually,", 2.8, 3.2),
      word("the", 3.25, 3.4),
      word("answer.", 3.45, 3.9),
    ]);

    expect(analysis.version).toBe("speech-structure/1.0.0");
    expect(analysis.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["long_pause", "false_start_candidate"]),
    );
  });

  it("marks a repeated phrase as a retake and preserves the earlier attempt", () => {
    const analysis = detectSpeechStructure("speech-2", [
      word("The", 0, 0.2),
      word("important", 0.25, 0.6),
      word("point", 0.65, 0.9),
      word("is", 0.95, 1.1),
      word("the", 1.8, 2),
      word("important", 2.05, 2.4),
      word("point", 2.45, 2.7),
      word("is", 2.75, 2.9),
      word("clarity.", 2.95, 3.3),
    ]);

    const retake = analysis.events.find(
      (event) => event.kind === "retake_candidate",
    );
    expect(retake?.startUs).toBe(1_800_000);
    expect(retake?.evidence.join(" ")).toContain("important point");
    expect(
      analysis.events.some(
        (event) =>
          event.kind === "false_start_candidate" && event.startUs === 0,
      ),
    ).toBe(true);
  });

  it("marks a short VAD gap inside an unfinished utterance as an interruption candidate", () => {
    const analysis = detectSpeechStructure(
      "speech-3",
      [
        word("This", 0, 0.25),
        word("means", 0.3, 0.6),
        word("we", 1.2, 1.35),
        word("continue.", 1.4, 1.8),
      ],
      [
        { startUs: 0, endUs: 650_000 },
        { startUs: 1_150_000, endUs: 1_900_000 },
      ],
    );

    expect(
      analysis.events.some(
        (event) => event.kind === "interruption_candidate",
      ),
    ).toBe(true);
  });

  it("does not mark a normal VAD gap after a completed sentence", () => {
    const analysis = detectSpeechStructure(
      "speech-4",
      [
        word("Done.", 0, 0.4),
        word("Next", 1, 1.2),
        word("point.", 1.25, 1.6),
      ],
      [
        { startUs: 0, endUs: 450_000 },
        { startUs: 950_000, endUs: 1_700_000 },
      ],
    );

    expect(
      analysis.events.some(
        (event) => event.kind === "interruption_candidate",
      ),
    ).toBe(false);
  });
});
