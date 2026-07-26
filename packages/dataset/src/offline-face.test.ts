import { describe, expect, it } from "vitest";
import { calibration, feature } from "../../measurement/src/test-fixtures";
import { reprocessOfflineFace, OFFLINE_FACE_WORKER_ID } from "./offline-face";

describe("offline face/motion reprocess", () => {
  it("produces versioned predictions without identity embeddings", () => {
    const cal = calibration();
    // Ensure calibration has samples the classifier can train on
    const samples = [
      feature({ eyeYaw: 0, eyePitch: 0 }),
      feature({ eyeYaw: 0.01, eyePitch: -0.01 }),
      feature({ eyeYaw: 0.2, eyePitch: 0.15 }),
    ];
    const richCal = {
      ...cal,
      samples: [
        { target: "lens" as const, feature: samples[0] },
        { target: "lens" as const, feature: samples[1] },
        { target: "down" as const, feature: samples[2] },
        { target: "left" as const, feature: feature({ eyeYaw: -0.3, eyePitch: 0 }) },
        { target: "right" as const, feature: feature({ eyeYaw: 0.3, eyePitch: 0 }) },
      ],
    };
    const features = [
      feature({ timestampUs: 0, eyeYaw: 0, eyePitch: 0 }),
      feature({ timestampUs: 33_000, eyeYaw: 0.02, eyePitch: 0 }),
      feature({ timestampUs: 66_000, eyeYaw: 0.25, eyePitch: 0.1 }),
    ];
    const result = reprocessOfflineFace(richCal, features);
    expect(result.workerId).toBe(OFFLINE_FACE_WORKER_ID);
    expect(result.algorithmVersion.length).toBeGreaterThan(0);
    expect(result.predictions).toHaveLength(3);
    expect(result.identityEmbeddings).toBeNull();
    expect(result.meanConfidence).toBeGreaterThanOrEqual(0);
    expect(result.predictions[0].calibrationId).toBe(richCal.id);
  });
});
