import { describe, expect, it } from "vitest";
import { VideoFrameWatchdog, unknownFeature } from "./provider";

describe("tracking frame-flow watchdog", () => {
  it("reports a stalled camera only after the media clock stops advancing", () => {
    const watchdog = new VideoFrameWatchdog(750);
    expect(watchdog.update(1, 0)).toBe("advancing");
    expect(watchdog.update(1, 749)).toBe("waiting");
    expect(watchdog.update(1, 750)).toBe("stalled");
    expect(watchdog.update(1.033, 800)).toBe("advancing");
  });

  it("creates an explicit unknown feature for tracker failures", () => {
    expect(unknownFeature(12.5)).toMatchObject({
      timestampUs: 12_500,
      confidence: 0,
      faceDetected: false,
      blink: false,
    });
  });
});
