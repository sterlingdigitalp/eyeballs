import { describe, expect, it } from "vitest";
import {
  sentenceBoundariesFromWords,
  speakingSeconds,
  StreamingVad,
  stubTranscript,
} from "./speaking";

describe("streaming VAD for hide-on-speech", () => {
  it("detects speaking without requiring transcription", () => {
    const vad = new StreamingVad({
      speechRmsThreshold: 0.02,
      hangoverSpeechFrames: 2,
      hangoverSilenceFrames: 3,
      minSpeakingUs: 100_000,
    });
    let speaking = false;
    for (let i = 0; i < 5; i += 1) {
      speaking = vad.push({ rms: 0.05, timestampUs: i * 20_000 });
    }
    expect(speaking).toBe(true);
    expect(vad.isSpeaking).toBe(true);

    for (let i = 5; i < 12; i += 1) {
      speaking = vad.push({ rms: 0.001, timestampUs: i * 20_000 });
    }
    expect(speaking).toBe(false);
    const windows = vad.finish(300_000);
    expect(windows.length).toBeGreaterThanOrEqual(1);
    expect(speakingSeconds(windows)).toBeGreaterThan(0);
  });

  it("ignores brief noise below hangover", () => {
    const vad = new StreamingVad({
      speechRmsThreshold: 0.02,
      hangoverSpeechFrames: 3,
      hangoverSilenceFrames: 3,
      minSpeakingUs: 50_000,
    });
    expect(vad.push({ rms: 0.1, timestampUs: 0 })).toBe(false);
    expect(vad.push({ rms: 0.1, timestampUs: 10_000 })).toBe(false);
    expect(vad.push({ rms: 0.0, timestampUs: 20_000 })).toBe(false);
  });
});

describe("post-session sentence boundaries", () => {
  it("groups words into sentences by punctuation", () => {
    const sentences = sentenceBoundariesFromWords([
      { text: "Hello", startUs: 0, endUs: 200_000 },
      { text: "world.", startUs: 200_000, endUs: 400_000 },
      { text: "Next", startUs: 500_000, endUs: 600_000 },
      { text: "line!", startUs: 600_000, endUs: 800_000 },
    ]);
    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toBe("Hello world.");
    expect(sentences[0].startUs).toBe(0);
    expect(sentences[1].text).toBe("Next line!");
  });

  it("provides an explicit ASR stub for review when transcription is unavailable", () => {
    const stub = stubTranscript();
    expect(stub.words).toEqual([]);
    expect(stub.sentences).toEqual([]);
    expect(stub.stubReason).toBe("asr_not_integrated");
  });
});
