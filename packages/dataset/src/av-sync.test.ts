import { describe, expect, it } from "vitest";
import { planMasterAssets } from "./capture";
import {
  applyDerivativeSyncCorrection,
  buildAvTimingMetadata,
  mastersUnchanged,
  measureInitialOffsetUs,
} from "./av-sync";

describe("A/V timing and derivative-only correction", () => {
  it("measures initial offset and drift metadata", () => {
    expect(measureInitialOffsetUs(1_000_000, 1_015_000)).toBe(15_000);
    const timing = buildAvTimingMetadata({
      videoMonotonicStartUs: 0,
      audioMonotonicStartUs: 10_000,
      driftSamples: [
        { elapsedUs: 0, observedOffsetUs: 10_000 },
        { elapsedUs: 3_600_000_000, observedOffsetUs: 40_000 },
      ],
    });
    expect(timing.initialOffsetUs).toBe(10_000);
    expect(timing.measuredDriftUsPerHour).toBe(30_000);
    expect(timing.uncorrectable).toBe(false);
  });

  it("applies correction only to a derivative proxy, not the master", () => {
    const [master] = planMasterAssets(
      {
        sessionId: "sess-sync",
        negotiatedVideo: { width: 1920, height: 1080, frameRate: 30 },
        videoMonotonicStartUs: 0,
        relativeMasterVideoPath: "sessions/sess-sync/master/video.mov",
      },
      "2026-07-25T12:00:00.000Z",
    );
    const sealed = { ...master, sha256: "master-hash", byteLength: 100, validationState: "valid" as const };
    const timing = buildAvTimingMetadata({
      videoMonotonicStartUs: 0,
      audioMonotonicStartUs: 5_000,
    });
    const { correctedProxy, timing: correctedTiming } = applyDerivativeSyncCorrection(
      sealed,
      timing,
      "2026-07-25T12:05:00.000Z",
    );
    expect(correctedProxy.role).toBe("sync_corrected_proxy");
    expect(correctedProxy.relativePath).not.toBe(sealed.relativePath);
    expect(correctedTiming.derivativeCorrectionUs).toBe(-5_000);
    expect(mastersUnchanged(sealed, sealed)).toBe(true);
    expect(correctedProxy.id).not.toBe(sealed.id);
  });
});
