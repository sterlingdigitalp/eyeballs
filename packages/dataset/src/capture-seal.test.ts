import { describe, expect, it } from "vitest";
import type { SessionManifest } from "../../contracts/src";
import {
  applyCaptureSealToManifest,
  ingestCaptureCoreSeal,
} from "./capture-seal";

const sessionRoot = "/Application Support/app/sessions/seal-1";
const hash = (digit: string) => digit.repeat(64);
const seal = () => ({
  protocolVersion: "1.0.0",
  sessionId: "seal-1",
  sessionRoot,
  exitCode: 0,
  status: "complete",
  dryRun: false,
  hashedBy: "rust-sha2",
  segmentCount: 4,
  segments: [
    {
      path: `${sessionRoot}/master/segments/seg_000_audio.caf`,
      sha256: hash("a"),
      byteLength: 1_000,
    },
    {
      path: `${sessionRoot}/master/segments/seg_000_video.mov`,
      sha256: hash("b"),
      byteLength: 10_000,
    },
    {
      path: `${sessionRoot}/master/segments/seg_001_audio.caf`,
      sha256: hash("c"),
      byteLength: 900,
    },
    {
      path: `${sessionRoot}/master/segments/seg_001_video.mov`,
      sha256: hash("d"),
      byteLength: 9_000,
    },
  ],
  capture: {
    negotiatedWidth: 3840,
    negotiatedHeight: 2160,
    measuredVideoFps: 23.97,
    wallDurationSec: 20.1,
    videoCodec: "h264",
    preferPcmAudio: true,
    firstVideoPtsUs: 5_000_000,
    firstAudioPtsUs: 5_053_370,
    avInitialOffsetUs: 53_370,
    videoFrames: 482,
    droppedVideo: 0,
  },
  writtenAt: "2026-07-26T12:00:00.000Z",
});

const manifest = (): SessionManifest => ({
  schemaVersion: "1.0.0",
  id: "seal-1",
  profileId: "studio",
  calibrationId: "calibration",
  trackerId: "tracker",
  trackerVersion: "1",
  algorithmVersion: "algorithm",
  startedAt: "2026-07-26T11:59:30.000Z",
  monotonicStartUs: 5_000_000,
  status: "finalizing",
  frameCount: 0,
  droppedFrameCount: 0,
  dataset: { intent: "dataset_candidate" },
});

describe("CaptureCore seal ingestion", () => {
  it("maps real sealed segments to immutable assets and a dependency graph", () => {
    const result = ingestCaptureCoreSeal(seal());
    expect(result.version).toBe("capture-seal-ingest/1.0.0");
    expect(result.assets).toHaveLength(4);
    expect(result.assets.every((asset) => asset.immutable)).toBe(true);
    expect(result.assets.every((asset) => asset.validationState === "valid")).toBe(true);
    expect(result.assets[0].relativePath).toBe(
      "sessions/seal-1/master/segments/seg_000_audio.caf",
    );
    expect(result.assets.find((asset) => asset.role === "master_video")?.codec).toBe(
      "h264",
    );
    expect(result.avTiming?.initialOffsetUs).toBe(53_370);

    const hashJob = result.jobs.find((job) => job.kind === "hash_assets")!;
    expect(hashJob.status).toBe("succeeded");
    expect(hashJob.workerId).toBe("capture-core/rust-sha2");
    const segmentJob = result.jobs.find((job) => job.kind === "segment")!;
    expect(segmentJob.dependsOnJobIds).toEqual([
      "seal-1-transcribe",
      "seal-1-offline_face",
      "seal-1-quality",
    ]);
  });

  it("applies measured capture facts and timing to the matching manifest", () => {
    const ingestion = ingestCaptureCoreSeal(seal());
    const updated = applyCaptureSealToManifest(manifest(), ingestion);
    expect(updated.status).toBe("complete");
    expect(updated.frameCount).toBe(482);
    expect(updated.droppedFrameCount).toBe(0);
    expect(updated.media?.durationUs).toBe(20_100_000);
    expect(updated.media?.byteLength).toBe(20_900);
    expect(updated.dataset?.intent).toBe("dataset_candidate");
    expect(updated.dataset?.avTiming?.initialOffsetUs).toBe(53_370);
  });

  it("rejects dry runs, incomplete seals, empty segments, and escaped paths", () => {
    expect(() =>
      ingestCaptureCoreSeal({ ...seal(), dryRun: true }),
    ).toThrow(/Dry-run/);
    expect(() =>
      ingestCaptureCoreSeal({ ...seal(), status: "failed", exitCode: 3 }),
    ).toThrow(/not complete/);
    expect(() =>
      ingestCaptureCoreSeal({
        ...seal(),
        segments: seal().segments.map((segment, index) =>
          index === 0 ? { ...segment, byteLength: 0 } : segment,
        ),
      }),
    ).toThrow(/empty/);
    expect(() =>
      ingestCaptureCoreSeal({
        ...seal(),
        segments: seal().segments.map((segment, index) =>
          index === 0
            ? { ...segment, path: "/tmp/seg_000_audio.caf" }
            : segment,
        ),
      }),
    ).toThrow(/escapes/);
    expect(() =>
      ingestCaptureCoreSeal({
        ...seal(),
        sessionId: "../outside",
      }),
    ).toThrow();
    expect(() =>
      ingestCaptureCoreSeal({
        ...seal(),
        sessionRoot: "/Application Support/app/../outside",
      }),
    ).toThrow(/normalized path/);
  });

  it("allows explicitly requested dry-run ingestion only for software tests", () => {
    const result = ingestCaptureCoreSeal(
      { ...seal(), dryRun: true },
      { allowDryRun: true },
    );
    expect(result.assets).toHaveLength(4);
  });
});
