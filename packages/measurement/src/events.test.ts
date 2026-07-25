import { describe, expect, it } from "vitest";
import type { GazePrediction } from "../../contracts/src";
import { GazeEventBuilder } from "./events";

const prediction = (timestampUs: number, state: GazePrediction["state"]): GazePrediction => ({
  timestampUs,
  state,
  rawState: state,
  confidence: 0.9,
  blinkSuppressed: false,
  calibrationId: "cal",
  trackerId: "tracker",
  trackerVersion: "1",
  algorithmVersion: "1",
});

describe("gaze events", () => {
  it("builds a break and recovery without counting unknown as contact", () => {
    const builder = new GazeEventBuilder();
    expect(builder.update(prediction(0, "contact"))).toEqual([]);
    expect(builder.update(prediction(100, "off_lens"))).toEqual([]);
    const events = builder.update(prediction(500, "contact"));
    expect(events.map((event) => event.type)).toEqual(["break", "recovery"]);
    expect(events[0]).toMatchObject({ startUs: 100, endUs: 500 });
  });

  it("treats near-lens return as a recovery", () => {
    const builder = new GazeEventBuilder();
    builder.update(prediction(0, "off_lens"));
    const events = builder.update(prediction(500_000, "near_lens"));
    expect(events.map((event) => event.type)).toEqual(["break", "recovery"]);
  });
});
