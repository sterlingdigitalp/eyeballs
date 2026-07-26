import { describe, expect, it } from "vitest";
import { grantConsent } from "./consent";
import { evaluatePreflight, shouldSurfaceMonitorEvent } from "./preflight";

describe("dataset preflight and critical monitor", () => {
  it("blocks dataset recording without consents and storage headroom", () => {
    const result = evaluatePreflight({
      intent: "dataset_candidate",
      consents: [],
      faceDetectedRatio: 0.99,
      faceScale: 0.3,
      brightnessOk: true,
      audioPeakDbfs: -12,
      roomNoiseDbfs: -50,
      diskFreeBytes: 100,
      estimatedSessionBytes: 1_000_000,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("recording_consent_required");
    expect(result.blockers).toContain("dataset_consent_required");
    expect(result.blockers).toContain("insufficient_storage");
  });

  it("passes when consent, face, audio, and storage are ok", () => {
    const recording = grantConsent("r", ["recording"], "2026-07-25T12:00:00.000Z");
    const dataset = grantConsent("d", ["dataset_include"], "2026-07-25T12:00:00.000Z");
    const result = evaluatePreflight({
      intent: "dataset_candidate",
      consents: [recording, dataset],
      recordingConsentId: recording.id,
      datasetConsentId: dataset.id,
      faceDetectedRatio: 0.98,
      faceScale: 0.28,
      brightnessOk: true,
      audioPeakDbfs: -10,
      roomNoiseDbfs: -48,
      diskFreeBytes: 50_000_000_000,
      estimatedSessionBytes: 2_000_000_000,
      outfitLabel: "navy shirt",
      backgroundLabel: "bookshelf",
    });
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("surfaces only critical in-session warnings after thresholds", () => {
    expect(shouldSurfaceMonitorEvent("device_lost", 1)).toBe(true);
    expect(shouldSurfaceMonitorEvent("audio_clipping", 1)).toBe(false);
    expect(shouldSurfaceMonitorEvent("audio_clipping", 3)).toBe(true);
    expect(shouldSurfaceMonitorEvent("face_missing", 5)).toBe(false);
    expect(shouldSurfaceMonitorEvent("face_missing", 15)).toBe(true);
  });
});
