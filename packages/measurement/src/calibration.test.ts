import { describe, expect, it } from "vitest";
import type { CaptureProfile } from "../../contracts/src";
import {
  calibrationQualityGate,
  calibrationInvalidationReason,
  evaluateHeldOutCalibration,
  isCalibrationContactState,
  isCalibrationContactTarget,
  scoreCalibration,
  scoreCalibrationTargets,
  selectActiveCalibration,
} from "./calibration";
import { calibration, feature } from "./test-fixtures";

const profile: CaptureProfile = {
  id: "profile-test",
  name: "MacBook Practice",
  kind: "macbook_practice",
  cameraDeviceId: "camera",
  cameraLabel: "FaceTime Camera",
  microphoneDeviceId: "mic",
  microphoneLabel: "MacBook Microphone",
  requestedVideo: { width: 1280, height: 720, frameRate: 30 },
  negotiatedVideo: { width: 1280, height: 720, frameRate: 30 },
  lensAnchor: { x: 0.5, y: 0 },
  updatedAt: new Date(0).toISOString(),
};

describe("calibration", () => {
  it("stays valid only for its exact setup and tracker", () => {
    const value = calibration();
    expect(calibrationInvalidationReason(value, profile, "fixture", "1.0.0")).toBeUndefined();
    expect(
      calibrationInvalidationReason(value, { ...profile, cameraDeviceId: "other" }, "fixture", "1.0.0"),
    ).toBe("Camera changed.");
    expect(calibrationInvalidationReason(value, profile, "fixture", "2.0.0")).toBe(
      "Tracking provider or model changed.",
    );
    expect(
      calibrationInvalidationReason(value, profile, "fixture", "1.0.0", "new-algorithm"),
    ).toBe("Classifier algorithm changed.");
  });

  it("rejects low-quality sample sets", () => {
    const result = scoreCalibration(
      Array.from({ length: 20 }, (_, index) => feature({ timestampUs: index, confidence: 0.2 })),
    );
    expect(result.score).toBeLessThan(0.5);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not mistake a constant positive gaze offset for target variation", () => {
    const result = scoreCalibration(
      Array.from({ length: 50 }, (_, index) =>
        feature({
          timestampUs: index,
          eyeYaw: 0.2,
          eyePitch: 0.15,
        }),
      ),
    );
    expect(result.warnings).toContain(
      "Targets did not produce enough gaze variation.",
    );
  });

  it("flags a target whose gaze changes substantially during the hold", () => {
    const samples = Array.from({ length: 30 }, (_, index) => ({
      target: "lens" as const,
      feature: feature({ eyeYaw: index < 15 ? -0.2 : 0.2 }),
    }));
    const result = scoreCalibrationTargets(samples);
    expect(result.lens.warnings).toContain(
      "Pose changed too much during the hold; repeat this target.",
    );
    expect(result.lens.score).toBeLessThan(0.8);
  });

  it("holds back target samples for an honest validation score", () => {
    const result = evaluateHeldOutCalibration(calibration());
    expect(result.validationSamples.length).toBeGreaterThan(0);
    expect(result.trainingSamples.length).toBeGreaterThan(result.validationSamples.length);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.85);
    expect(Object.values(result.byTarget).every((target) => target.accuracy >= 0.85)).toBe(true);
  });

  it("uses the same binary contact definition as review metrics", () => {
    expect(isCalibrationContactTarget("lens")).toBe(true);
    expect(isCalibrationContactTarget("near_lens")).toBe(true);
    expect(isCalibrationContactTarget("head_left_eyes_lens")).toBe(true);
    expect(isCalibrationContactTarget("head_down_eyes_lens")).toBe(true);
    expect(isCalibrationContactTarget("left")).toBe(false);
    expect(isCalibrationContactState("contact")).toBe(true);
    expect(isCalibrationContactState("near_lens")).toBe(true);
    expect(isCalibrationContactState("off_lens")).toBe(false);
    expect(isCalibrationContactState("unknown")).toBe(false);
  });

  it("uses an explicitly separate validation pass when one is present", () => {
    const value = calibration();
    const explicitValidation = value.samples.filter((_, index) => index % 5 === 4);
    const result = evaluateHeldOutCalibration({
      ...value,
      validationSamples: explicitValidation,
    });
    expect(result.trainingSamples).toHaveLength(value.samples.length);
    expect(result.validationSamples).toEqual(explicitValidation);
  });

  it("does not let aggregate accuracy hide a weak physical-lens target", () => {
    const rejected = calibrationQualityGate(0.94, {
      lens: { correct: 3, evaluated: 10, accuracy: 0.3 },
      left: { correct: 10, evaluated: 10, accuracy: 1 },
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.reasons).toHaveLength(1);
    expect(calibrationQualityGate(0.9, {
      lens: { correct: 8, evaluated: 10, accuracy: 0.8 },
      left: { correct: 9, evaluated: 10, accuracy: 0.9 },
    }).accepted).toBe(true);
  });

  it("rejects required validation targets with insufficient usable samples", () => {
    const result = calibrationQualityGate(
      0.95,
      {
        lens: { correct: 8, evaluated: 8, accuracy: 1 },
      },
      ["lens", "down"],
    );
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain(
      "down needs at least five usable hidden-validation samples.",
    );
  });

  it("isolates calibrations for profiles that share the same hardware", () => {
    const contactsProfile = { ...profile, id: "contacts-profile", name: "MacBook · Contacts" };
    const glassesProfile = { ...profile, id: "glasses-profile", name: "MacBook · Glasses" };
    const contactsOlder = {
      ...calibration(),
      id: "contacts-older",
      profileId: contactsProfile.id,
      createdAt: new Date(1).toISOString(),
    };
    const contactsNewest = {
      ...calibration(),
      id: "contacts-newest",
      profileId: contactsProfile.id,
      createdAt: new Date(2).toISOString(),
    };
    const glasses = {
      ...calibration(),
      id: "glasses",
      profileId: glassesProfile.id,
      createdAt: new Date(3).toISOString(),
    };

    expect(
      selectActiveCalibration(
        [glasses, contactsOlder, contactsNewest],
        contactsProfile,
        "fixture",
        "1.0.0",
        contactsNewest.algorithmVersion,
      )?.id,
    ).toBe("contacts-newest");
    expect(
      selectActiveCalibration(
        [contactsNewest, glasses],
        glassesProfile,
        "fixture",
        "1.0.0",
        glasses.algorithmVersion,
      )?.id,
    ).toBe("glasses");
  });
});
