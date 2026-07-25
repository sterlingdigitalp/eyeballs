import type { Calibration, FeatureVector } from "../../contracts/src";
import { ALGORITHM_VERSION } from "./classifier";

export function feature(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    schemaVersion: "1.0.0",
    timestampUs: 0,
    confidence: 0.95,
    faceDetected: true,
    blink: false,
    eyeYaw: 0,
    eyePitch: 0,
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    faceScale: 0.35,
    ...overrides,
  };
}

export function calibration(): Calibration {
  const samples: Calibration["samples"] = [];
  for (let index = 0; index < 20; index += 1) {
    const noise = (index - 10) / 1000;
    samples.push({ target: "lens", feature: feature({ eyeYaw: noise, eyePitch: -noise }) });
    samples.push({ target: "left", feature: feature({ eyeYaw: -0.32 + noise, eyePitch: 0.01 }) });
    samples.push({ target: "right", feature: feature({ eyeYaw: 0.32 + noise, eyePitch: 0.01 }) });
    samples.push({ target: "down", feature: feature({ eyeYaw: noise, eyePitch: 0.34 }) });
  }
  return {
    id: "calibration-test",
    profileId: "profile-test",
    trackerId: "fixture",
    trackerVersion: "1.0.0",
    featureSchemaVersion: "1.0.0",
    algorithmVersion: ALGORITHM_VERSION,
    createdAt: new Date(0).toISOString(),
    setupFingerprint: {
      cameraDeviceId: "camera",
      width: 1280,
      height: 720,
      frameRate: 30,
      lensAnchorX: 0.5,
      lensAnchorY: 0,
    },
    samples,
    quality: { score: 1, sampleCount: samples.length, warnings: [], heldOutAccuracy: 1, targetQuality: {} },
  };
}
