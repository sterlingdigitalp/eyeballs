import type { AvTimingMetadata, RecordingAsset } from "../../contracts/src";

export function measureInitialOffsetUs(
  videoMonotonicStartUs: number,
  audioMonotonicStartUs: number,
): number {
  return audioMonotonicStartUs - videoMonotonicStartUs;
}

/**
 * Estimate drift from paired sample clocks over a long capture.
 * positive = audio runs ahead of video per hour.
 */
export function estimateDriftUsPerHour(
  samples: Array<{ elapsedUs: number; observedOffsetUs: number }>,
): number | undefined {
  if (samples.length < 2) return undefined;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const deltaElapsed = last.elapsedUs - first.elapsedUs;
  if (deltaElapsed <= 0) return undefined;
  const deltaOffset = last.observedOffsetUs - first.observedOffsetUs;
  return (deltaOffset / deltaElapsed) * 3_600_000_000;
}

export function buildAvTimingMetadata(args: {
  videoMonotonicStartUs: number;
  audioMonotonicStartUs: number;
  driftSamples?: Array<{ elapsedUs: number; observedOffsetUs: number }>;
  maxCorrectableAbsOffsetUs?: number;
}): AvTimingMetadata {
  const initialOffsetUs = measureInitialOffsetUs(
    args.videoMonotonicStartUs,
    args.audioMonotonicStartUs,
  );
  const measuredDriftUsPerHour = args.driftSamples
    ? estimateDriftUsPerHour(args.driftSamples)
    : undefined;
  const maxCorrectable = args.maxCorrectableAbsOffsetUs ?? 50_000;
  const uncorrectable = Math.abs(initialOffsetUs) > maxCorrectable * 20;
  return {
    videoMonotonicStartUs: args.videoMonotonicStartUs,
    audioMonotonicStartUs: args.audioMonotonicStartUs,
    initialOffsetUs,
    measuredDriftUsPerHour,
    syncConfidence: uncorrectable ? 0.2 : 0.9,
    uncorrectable,
  };
}

/**
 * Derivative-only correction: returns a new proxy asset descriptor.
 * Never mutates master asset identity or path.
 */
export function applyDerivativeSyncCorrection(
  masterVideo: RecordingAsset,
  timing: AvTimingMetadata,
  createdAt: string,
): { correctedProxy: RecordingAsset; timing: AvTimingMetadata } {
  if (masterVideo.role !== "master_video") {
    throw new Error("Sync correction requires master_video as source identity");
  }
  if (timing.uncorrectable) {
    throw new Error("Drift cannot be corrected confidently");
  }
  const correctionUs = -timing.initialOffsetUs;
  const timingWithCorrection: AvTimingMetadata = {
    ...timing,
    derivativeCorrectionUs: correctionUs,
  };
  const correctedProxy: RecordingAsset = {
    id: `${masterVideo.sessionId}-sync-corrected-proxy`,
    sessionId: masterVideo.sessionId,
    role: "sync_corrected_proxy",
    relativePath: `sessions/${masterVideo.sessionId}/proxy/sync-corrected.mp4`,
    mimeType: "video/mp4",
    byteLength: 0,
    validationState: "pending",
    immutable: false,
    createdAt,
    monotonicStartUs: masterVideo.monotonicStartUs,
  };
  // Master identity unchanged
  if (masterVideo.relativePath.includes("sync-corrected")) {
    throw new Error("Master path must not be a corrected derivative");
  }
  return { correctedProxy, timing: timingWithCorrection };
}

export function mastersUnchanged(
  before: RecordingAsset,
  after: RecordingAsset,
): boolean {
  return (
    before.id === after.id &&
    before.relativePath === after.relativePath &&
    before.sha256 === after.sha256 &&
    before.role === after.role
  );
}
