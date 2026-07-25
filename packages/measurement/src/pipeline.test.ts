import { describe, expect, it } from "vitest";
import { trainClassifier } from "./classifier";
import { MeasurementPipeline } from "./pipeline";
import { calibration, feature } from "./test-fixtures";

describe("tracker-to-event measurement pipeline", () => {
  it("classifies, applies hysteresis, suppresses blinks, and completes events", () => {
    const pipeline = new MeasurementPipeline(
      trainClassifier(calibration()),
      { enterOffLensMs: 100, returnContactMs: 50, unknownAfterMs: 50 },
    );
    pipeline.process(feature({ timestampUs: 0 }));
    expect(
      pipeline.process(feature({ timestampUs: 50_000 })).prediction.state,
    ).toBe("contact");
    expect(
      pipeline.process(feature({ timestampUs: 70_000, blink: true })).prediction.state,
    ).toBe("contact");
    pipeline.process(feature({ timestampUs: 100_000, eyeYaw: 0.34 }));
    expect(
      pipeline.process(feature({ timestampUs: 200_000, eyeYaw: 0.34 })).prediction.state,
    ).toBe("off_lens");
    const recovery = pipeline.process(feature({ timestampUs: 250_000 }));
    const completed = pipeline.process(feature({ timestampUs: 300_000 }));
    expect(recovery.prediction.state).toBe("off_lens");
    expect(completed.prediction.state).toBe("contact");
    expect(completed.completedEvents.map((event) => event.type)).toEqual([
      "break",
      "recovery",
    ]);
  });

  it("propagates low tracking confidence to unknown without a corrective break", () => {
    const pipeline = new MeasurementPipeline(
      trainClassifier(calibration()),
      { enterOffLensMs: 0, returnContactMs: 0, unknownAfterMs: 0 },
    );
    const first = pipeline.process(feature({ timestampUs: 0, confidence: 0.2 }));
    const second = pipeline.process(feature({ timestampUs: 1, confidence: 0.2 }));
    expect(second.prediction.state).toBe("unknown");
    expect(first.completedEvents).toEqual([]);
    expect(second.completedEvents).toEqual([]);
    expect(pipeline.finish(10).map((event) => event.type)).toEqual(["unknown"]);
  });
});
