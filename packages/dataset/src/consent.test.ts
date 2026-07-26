import { describe, expect, it } from "vitest";
import type { SessionManifest } from "../../contracts/src";
import {
  assertCanPromoteToDataset,
  attachDatasetIntent,
  ConsentError,
  faceDoesNotImplyVoice,
  grantConsent,
  isConsentActive,
  revokeConsent,
  scopesAreIndependent,
} from "./consent";

const baseManifest = (): SessionManifest => ({
  schemaVersion: "1.0.0",
  id: "session-1",
  profileId: "p",
  calibrationId: "c",
  trackerId: "t",
  trackerVersion: "1",
  algorithmVersion: "a",
  startedAt: "2026-07-25T12:00:00.000Z",
  monotonicStartUs: 0,
  status: "complete",
  frameCount: 10,
  droppedFrameCount: 0,
});

describe("consent foundation", () => {
  it("grants and revokes scopes without bundling face into voice", () => {
    const face = grantConsent("face-1", ["face_analysis"], "2026-07-25T12:00:00.000Z");
    const voice = grantConsent("voice-1", ["voice_analysis"], "2026-07-25T12:00:00.000Z");
    expect(scopesAreIndependent(face, voice)).toBe(true);
    expect(isConsentActive(face, "voice_analysis")).toBe(false);
    expect(isConsentActive(voice, "face_analysis")).toBe(false);
    expect(faceDoesNotImplyVoice(face)).toBe(true);
    expect(faceDoesNotImplyVoice(voice)).toBe(false);
    const both = grantConsent("both", ["face_analysis", "voice_analysis"], "2026-07-25T12:00:00.000Z");
    expect(faceDoesNotImplyVoice(both)).toBe(false);

    const revoked = revokeConsent(face, "2026-07-25T13:00:00.000Z");
    expect(isConsentActive(revoked, "face_analysis")).toBe(false);
    expect(() => revokeConsent(revoked, "2026-07-25T14:00:00.000Z")).toThrow(
      ConsentError,
    );
  });

  it("rejects dataset promotion without recording and dataset_include consents", () => {
    const recording = grantConsent(
      "rec-1",
      ["recording"],
      "2026-07-25T12:00:00.000Z",
    );
    let session = attachDatasetIntent(baseManifest(), "dataset_candidate", {
      recordingConsentId: recording.id,
    });
    expect(() =>
      assertCanPromoteToDataset({ session, consents: [recording] }),
    ).toThrow(/dataset_include|Missing consent/i);

    const dataset = grantConsent(
      "ds-1",
      ["dataset_include"],
      "2026-07-25T12:00:00.000Z",
    );
    session = attachDatasetIntent(session, "dataset_candidate", {
      recordingConsentId: recording.id,
      datasetConsentId: dataset.id,
    });
    expect(() =>
      assertCanPromoteToDataset({ session, consents: [recording, dataset] }),
    ).not.toThrow();
  });

  it("enforces face and voice analysis scopes independently for promotion", () => {
    const recording = grantConsent("r", ["recording"], "2026-07-25T12:00:00.000Z");
    const dataset = grantConsent("d", ["dataset_include"], "2026-07-25T12:00:00.000Z");
    const face = grantConsent("f", ["face_analysis"], "2026-07-25T12:00:00.000Z");
    const session = attachDatasetIntent(baseManifest(), "dataset_candidate", {
      recordingConsentId: recording.id,
      datasetConsentId: dataset.id,
      faceAnalysisConsentId: face.id,
    });
    expect(() =>
      assertCanPromoteToDataset({
        session,
        consents: [recording, dataset, face],
        requireFaceAnalysis: true,
        requireVoiceAnalysis: true,
      }),
    ).toThrow(/voice_analysis/);

    const voice = grantConsent("v", ["voice_analysis"], "2026-07-25T12:00:00.000Z");
    const withVoice = attachDatasetIntent(session, "dataset_candidate", {
      ...session.dataset,
      voiceAnalysisConsentId: voice.id,
    });
    expect(() =>
      assertCanPromoteToDataset({
        session: withVoice,
        consents: [recording, dataset, face, voice],
        requireFaceAnalysis: true,
        requireVoiceAnalysis: true,
      }),
    ).not.toThrow();
  });

  it("blocks promotion when dataset consent is revoked", () => {
    const recording = grantConsent("r2", ["recording"], "2026-07-25T12:00:00.000Z");
    const dataset = grantConsent("d2", ["dataset_include"], "2026-07-25T12:00:00.000Z");
    const revoked = revokeConsent(dataset, "2026-07-25T12:30:00.000Z");
    const session = attachDatasetIntent(baseManifest(), "dataset_candidate", {
      recordingConsentId: recording.id,
      datasetConsentId: dataset.id,
    });
    expect(() =>
      assertCanPromoteToDataset({
        session,
        consents: [recording, revoked],
      }),
    ).toThrow(ConsentError);
  });
});
