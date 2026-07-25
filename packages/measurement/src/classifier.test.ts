import { describe, expect, it } from "vitest";
import { classifyFrame, TemporalClassifier, trainClassifier } from "./classifier";
import { calibration, feature } from "./test-fixtures";

describe("personalized classifier", () => {
  const model = trainClassifier(calibration());

  it("separates calibrated lens and off-lens targets", () => {
    expect(classifyFrame(model, feature({ eyeYaw: 0.01 })).rawState).toBe("contact");
    expect(classifyFrame(model, feature({ eyeYaw: 0.34 })).rawState).toBe("off_lens");
  });

  it("uses unknown instead of guessing when confidence is low", () => {
    const lowConfidence = classifyFrame(model, feature({ confidence: 0.2 }));
    expect(lowConfidence.rawState).toBe("unknown");
    expect(lowConfidence.classProbabilities?.unknown).toBe(1);
    expect(classifyFrame(model, feature({ faceDetected: false })).rawState).toBe("unknown");
  });

  it("reports normalized per-class probabilities for diagnostics", () => {
    const prediction = classifyFrame(model, feature({ eyeYaw: 0.01 }));
    const probabilities = Object.values(prediction.classProbabilities ?? {});
    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(prediction.classProbabilities?.contact).toBeGreaterThan(
      prediction.classProbabilities?.off_lens ?? 1,
    );
  });

  it("uses unknown for ambiguous and out-of-distribution geometry", () => {
    expect(classifyFrame(model, feature({ eyeYaw: 0.16 })).rawState).toBe("unknown");
    expect(classifyFrame(model, feature({ eyeYaw: 3, eyePitch: -3 })).rawState).toBe(
      "unknown",
    );
  });

  it("excludes blinked and low-confidence samples from contact-radius training", () => {
    const clean = calibration();
    const contaminated = {
      ...clean,
      samples: [
        ...clean.samples,
        ...Array.from({ length: 20 }, (_, index) => ({
          target: "lens" as const,
          feature: feature({
            timestampUs: 10_000 + index,
            confidence: 0.2,
            eyeYaw: 8,
            eyePitch: -8,
          }),
        })),
        {
          target: "lens" as const,
          feature: feature({ timestampUs: 40_000, blink: true, eyeYaw: -8, eyePitch: 8 }),
        },
      ],
    };
    expect(trainClassifier(contaminated).contactRadius).toBeCloseTo(model.contactRadius);
  });

  it("uses robust target centers so a minority of tracked iris outliers cannot move the lens cluster", () => {
    const clean = calibration();
    const contaminated = {
      ...clean,
      samples: [
        ...clean.samples,
        ...Array.from({ length: 5 }, (_, index) => ({
          target: "lens" as const,
          feature: feature({
            timestampUs: 50_000 + index,
            eyeYaw: 4 + index,
            eyePitch: -4 - index,
          }),
        })),
      ],
    };
    const robust = trainClassifier(contaminated);
    expect(classifyFrame(robust, feature({ eyeYaw: 0.01 })).rawState).toBe("contact");
    expect(classifyFrame(robust, feature({ eyeYaw: 0.34 })).rawState).toBe("off_lens");
  });

  it("suppresses blinks", () => {
    const temporal = new TemporalClassifier({ enterOffLensMs: 100, returnContactMs: 0, unknownAfterMs: 50 });
    const contact = classifyFrame(model, feature({ timestampUs: 0 }));
    temporal.update(contact);
    const stable = temporal.update({ ...contact, timestampUs: 10_000 });
    expect(stable.state).toBe("contact");
    const blink = temporal.update(classifyFrame(model, feature({ timestampUs: 20_000, blink: true })));
    expect(blink.state).toBe("contact");
    expect(blink.blinkSuppressed).toBe(true);
  });

  it("does not count blink duration toward an off-lens transition", () => {
    const temporal = new TemporalClassifier({
      enterOffLensMs: 450,
      returnContactMs: 0,
      unknownAfterMs: 50,
    });
    const contact = classifyFrame(model, feature({ timestampUs: 0 }));
    temporal.update(contact);
    temporal.update({ ...contact, timestampUs: 1 });
    const off = classifyFrame(model, feature({ timestampUs: 100_000, eyeYaw: 0.34 }));
    expect(temporal.update(off).state).toBe("contact");
    const blink = classifyFrame(
      model,
      feature({ timestampUs: 600_000, eyeYaw: 0.34, blink: true }),
    );
    expect(temporal.update(blink).state).toBe("contact");
    expect(temporal.update({ ...off, timestampUs: 601_000 }).state).toBe("contact");
    expect(temporal.update({ ...off, timestampUs: 1_051_000 }).state).toBe("off_lens");
  });

  it("requires sustained off-lens input before changing state", () => {
    const temporal = new TemporalClassifier({ enterOffLensMs: 450, returnContactMs: 0, unknownAfterMs: 50 });
    const contact = classifyFrame(model, feature({ timestampUs: 0 }));
    temporal.update(contact);
    temporal.update({ ...contact, timestampUs: 1 });
    const off = classifyFrame(model, feature({ timestampUs: 100_000, eyeYaw: 0.34 }));
    expect(temporal.update(off).state).toBe("contact");
    expect(temporal.update({ ...off, timestampUs: 549_000 }).state).toBe("contact");
    expect(temporal.update({ ...off, timestampUs: 550_000 }).state).toBe("off_lens");
  });
});
