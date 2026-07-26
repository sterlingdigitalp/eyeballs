import { describe, expect, it } from "vitest";
import type { SessionManifest } from "../../contracts/src";
import { attachDatasetIntent, grantConsent, revokeConsent } from "./consent";
import { planMasterAssets, applyCaptureBytes } from "./capture";
import { createHumanClip, labelClip } from "./curation";
import { isSha256Hex } from "./sha256";
import {
  buildExportPackage,
  createDatasetVersion,
  createVersionExcludingRevoked,
  hashManifestBody,
  stableStringify,
  verifyExportPackage,
} from "./versioning";

const session = (id: string, recordingId: string, datasetId: string): SessionManifest =>
  attachDatasetIntent(
    {
      schemaVersion: "1.0.0",
      id,
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
    },
    "dataset_candidate",
    { recordingConsentId: recordingId, datasetConsentId: datasetId },
  );

function fixtures() {
  const recording = grantConsent("rec", ["recording"], "2026-07-25T12:00:00.000Z");
  const dataset = grantConsent("ds", ["dataset_include"], "2026-07-25T12:00:00.000Z");
  const s1 = session("sess-a", recording.id, dataset.id);
  const s2 = session("sess-b", recording.id, dataset.id);
  const clips = [
    labelClip(createHumanClip("sess-a", 0, 3_000_000), "excellent"),
    labelClip(createHumanClip("sess-b", 0, 4_000_000), "usable"),
  ];
  const masters = [
    ...planMasterAssets(
      {
        sessionId: "sess-a",
        negotiatedVideo: { width: 1920, height: 1080, frameRate: 30 },
        videoMonotonicStartUs: 0,
        relativeMasterVideoPath: "sessions/sess-a/master/video.mov",
      },
      "2026-07-25T12:00:00.000Z",
    ),
    ...planMasterAssets(
      {
        sessionId: "sess-b",
        negotiatedVideo: { width: 1920, height: 1080, frameRate: 30 },
        videoMonotonicStartUs: 0,
        relativeMasterVideoPath: "sessions/sess-b/master/video.mov",
      },
      "2026-07-25T12:00:00.000Z",
    ),
  ].map((asset) =>
    applyCaptureBytes(asset, 1000, `hash-${asset.sessionId}`, 5_000_000),
  );
  return { recording, dataset, s1, s2, clips, masters };
}

describe("dataset versions and export", () => {
  it("creates immutable version manifests and export packages; revoke yields new version", async () => {
    const { recording, dataset, s1, s2, clips, masters } = fixtures();

    const v1 = await createDatasetVersion({
      datasetId: "dataset-1",
      version: 1,
      createdAt: "2026-07-25T13:00:00.000Z",
      sessions: [s1, s2],
      consents: [recording, dataset],
      clips,
      assets: masters,
    });
    expect(v1.immutable).toBe(true);
    expect(v1.clipIds).toHaveLength(2);
    expect(isSha256Hex(v1.manifestSha256)).toBe(true);
    const priorHash = v1.manifestSha256;

    const fileContents = {
      "manifest.json": new TextEncoder().encode(JSON.stringify(v1)),
      "clips/clip_0001.mp4": new Uint8Array([1, 2, 3]),
    };
    const pkg = await buildExportPackage(v1, fileContents);
    expect(pkg.format).toBe("presenter_dataset_export/1.0.0");
    expect(isSha256Hex(pkg.packageSha256)).toBe(true);
    expect(await verifyExportPackage(pkg, fileContents)).toBe(true);

    const revoked = revokeConsent(dataset, "2026-07-25T14:00:00.000Z");
    const dataset2 = grantConsent("ds2", ["dataset_include"], "2026-07-25T14:05:00.000Z");
    const s1b = session("sess-a", recording.id, dataset2.id);
    const remainingClips = [labelClip(createHumanClip("sess-a", 0, 3_000_000), "excellent")];
    const { prior, next } = await createVersionExcludingRevoked(v1, {
      createdAt: "2026-07-25T14:10:00.000Z",
      revokedConsentIds: [revoked.id],
      sessions: [s1b],
      consents: [recording, dataset2],
      clips: remainingClips,
      assets: masters.filter((asset) => asset.sessionId === "sess-a"),
    });
    expect(prior.manifestSha256).toBe(priorHash);
    expect(next.version).toBe(2);
    expect(next.clipIds).toHaveLength(1);
    expect(next.sourceSessionIds).toEqual(["sess-a"]);
    expect(v1.clipIds).toHaveLength(2);
  });

  it("changes manifestSha256 when clip labels, ranges, or asset hashes change", async () => {
    const { recording, dataset, s1, masters } = fixtures();
    const baseClips = [labelClip(createHumanClip("sess-a", 0, 3_000_000), "excellent")];
    const vLabel = await createDatasetVersion({
      datasetId: "dataset-hash",
      version: 1,
      createdAt: "2026-07-25T13:00:00.000Z",
      sessions: [s1],
      consents: [recording, dataset],
      clips: baseClips,
      assets: masters.filter((asset) => asset.sessionId === "sess-a"),
    });
    const vOtherLabel = await createDatasetVersion({
      datasetId: "dataset-hash",
      version: 1,
      createdAt: "2026-07-25T13:00:00.000Z",
      sessions: [s1],
      consents: [recording, dataset],
      clips: [labelClip(createHumanClip("sess-a", 0, 3_000_000), "usable")],
      assets: masters.filter((asset) => asset.sessionId === "sess-a"),
    });
    expect(vLabel.manifestSha256).not.toBe(vOtherLabel.manifestSha256);

    const vRange = await createDatasetVersion({
      datasetId: "dataset-hash",
      version: 1,
      createdAt: "2026-07-25T13:00:00.000Z",
      sessions: [s1],
      consents: [recording, dataset],
      clips: [labelClip(createHumanClip("sess-a", 0, 5_000_000), "excellent")],
      assets: masters.filter((asset) => asset.sessionId === "sess-a"),
    });
    expect(vRange.manifestSha256).not.toBe(vLabel.manifestSha256);

    const remastered = masters
      .filter((asset) => asset.sessionId === "sess-a")
      .map((asset) => applyCaptureBytes(asset, 1000, "different-asset-hash", 5_000_000));
    const vAssets = await createDatasetVersion({
      datasetId: "dataset-hash",
      version: 1,
      createdAt: "2026-07-25T13:00:00.000Z",
      sessions: [s1],
      consents: [recording, dataset],
      clips: baseClips,
      assets: remastered,
    });
    expect(vAssets.manifestSha256).not.toBe(vLabel.manifestSha256);
    expect(vAssets.assetHashes).not.toEqual(vLabel.assetHashes);

    const nested = { clips: [{ label: "excellent", startUs: 1 }], assetHashes: { a: "1" } };
    expect(stableStringify(nested)).toContain("excellent");
    expect(stableStringify(nested)).toContain("startUs");
    expect(stableStringify(nested)).toContain("\"a\"");
    const bodyA = {
      id: "x",
      version: 1,
      createdAt: "t",
      immutable: true as const,
      clipIds: ["c"],
      clips: [{ clipId: "c", sessionId: "s", startUs: 0, endUs: 1, label: "excellent", sourceAssetIds: [] }],
      consentIds: [],
      sourceSessionIds: ["s"],
      assetHashes: { m: "hash-a" },
    };
    const bodyB = { ...bodyA, assetHashes: { m: "hash-b" } };
    expect(await hashManifestBody(bodyA)).not.toBe(await hashManifestBody(bodyB));
  });

  it("fails verifyExportPackage when file bytes or declared hashes are tampered", async () => {
    const { recording, dataset, s1, masters } = fixtures();
    const v1 = await createDatasetVersion({
      datasetId: "dataset-tamper",
      version: 1,
      createdAt: "2026-07-25T13:00:00.000Z",
      sessions: [s1],
      consents: [recording, dataset],
      clips: [labelClip(createHumanClip("sess-a", 0, 3_000_000), "excellent")],
      assets: masters.filter((asset) => asset.sessionId === "sess-a"),
    });
    const fileContents = {
      "README.md": new TextEncoder().encode("# dataset\n"),
      "clips/a.mp4": new Uint8Array([10, 20, 30, 40]),
    };
    const pkg = await buildExportPackage(v1, fileContents);
    expect(await verifyExportPackage(pkg, fileContents)).toBe(true);

    const tamperedBytes = {
      ...fileContents,
      "clips/a.mp4": new Uint8Array([99, 99, 99, 99]),
    };
    expect(await verifyExportPackage(pkg, tamperedBytes)).toBe(false);

    const forgedFiles = {
      ...pkg,
      files: pkg.files.map((file) =>
        file.relativePath === "clips/a.mp4"
          ? { ...file, sha256: "0".repeat(64) }
          : file,
      ),
    };
    expect(await verifyExportPackage(forgedFiles, fileContents)).toBe(false);

    const forgedPackage = { ...pkg, packageSha256: "0".repeat(64) };
    expect(await verifyExportPackage(forgedPackage, fileContents)).toBe(false);

    const forgedManifest = {
      ...pkg,
      manifest: {
        ...pkg.manifest,
        clips: pkg.manifest.clips.map((clip) => ({ ...clip, label: "usable" })),
      },
    };
    expect(await verifyExportPackage(forgedManifest, fileContents)).toBe(false);
  });
});
