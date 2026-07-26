import { describe, expect, it } from "vitest";
import type { SessionManifest } from "../../contracts/src";
import { planMasterAssets } from "./capture";
import {
  finalizeSessionRecording,
  transitionJob,
  validateSealedAsset,
} from "./finalize";
import { isSha256Hex, sha256Hex } from "./sha256";

const manifest = (): SessionManifest => ({
  schemaVersion: "1.0.0",
  id: "fin-1",
  profileId: "p",
  calibrationId: "c",
  trackerId: "t",
  trackerVersion: "1",
  algorithmVersion: "a",
  startedAt: "2026-07-25T12:00:00.000Z",
  monotonicStartUs: 0,
  status: "recording",
  frameCount: 100,
  droppedFrameCount: 0,
});

describe("finalization pipeline", () => {
  it("hashes masters with real SHA-256, marks complete, and enqueues analysis jobs", async () => {
    const masters = planMasterAssets(
      {
        sessionId: "fin-1",
        negotiatedVideo: { width: 1920, height: 1080, frameRate: 30 },
        negotiatedAudio: { sampleRate: 48_000, channelCount: 1 },
        videoMonotonicStartUs: 0,
        audioMonotonicStartUs: 0,
        relativeMasterVideoPath: "sessions/fin-1/master/video.mov",
        relativeMasterAudioPath: "sessions/fin-1/master/audio.wav",
      },
      "2026-07-25T12:00:00.000Z",
    );
    const videoBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const audioBytes = new Uint8Array([9, 8, 7]);
    const result = await finalizeSessionRecording({
      manifest: manifest(),
      masters,
      masterBytes: {
        [masters[0].id]: videoBytes,
        [masters[1].id]: audioBytes,
      },
      nowIso: "2026-07-25T12:10:00.000Z",
      useSha256: true,
    });
    expect(result.status).toBe("complete");
    expect(result.manifest.status).toBe("complete");
    const video = result.assets.find((asset) => asset.role === "master_video")!;
    expect(video.sha256).toBe(await sha256Hex(videoBytes));
    expect(isSha256Hex(video.sha256!)).toBe(true);
    expect(video.relativePath).toBe("sessions/fin-1/master/video.mov");
    expect(video.immutable).toBe(true);
    expect(validateSealedAsset(video)).toBe("complete");
    expect(result.jobs.some((job) => job.kind === "transcribe")).toBe(true);
    expect(result.jobs.every((job) => job.status === "pending")).toBe(true);
    expect(result.assets.some((asset) => asset.role === "proxy_video")).toBe(true);
  });

  it("marks incomplete when master bytes are empty and does not invent success hashes for export", async () => {
    const masters = planMasterAssets(
      {
        sessionId: "fin-2",
        negotiatedVideo: { width: 1280, height: 720, frameRate: 30 },
        videoMonotonicStartUs: 0,
        relativeMasterVideoPath: "sessions/fin-2/master/video.mov",
      },
      "2026-07-25T12:00:00.000Z",
    );
    const result = await finalizeSessionRecording({
      manifest: { ...manifest(), id: "fin-2" },
      masters,
      masterBytes: { [masters[0].id]: new Uint8Array() },
      nowIso: "2026-07-25T12:10:00.000Z",
    });
    expect(result.status).toBe("incomplete");
    expect(result.manifest.status).toBe("incomplete");
    expect(result.jobs.map((job) => job.kind)).toEqual(["validate_media"]);
  });

  it("transitions job states with progress and output hashes", async () => {
    const masters = planMasterAssets(
      {
        sessionId: "fin-3",
        negotiatedVideo: { width: 1280, height: 720, frameRate: 30 },
        videoMonotonicStartUs: 0,
        relativeMasterVideoPath: "sessions/fin-3/master/video.mov",
      },
      "2026-07-25T12:00:00.000Z",
    );
    const result = await finalizeSessionRecording({
      manifest: { ...manifest(), id: "fin-3" },
      masters,
      masterBytes: { [masters[0].id]: new Uint8Array([1]) },
      nowIso: "2026-07-25T12:00:00.000Z",
    });
    const job = result.jobs[0];
    const running = transitionJob(job, "running", { progress: 0.5 }, "2026-07-25T12:01:00.000Z");
    expect(running.status).toBe("running");
    const done = transitionJob(
      running,
      "succeeded",
      { progress: 1, outputHashes: ["out"] },
      "2026-07-25T12:02:00.000Z",
    );
    expect(done.status).toBe("succeeded");
    expect(done.outputHashes).toEqual(["out"]);
  });
});
