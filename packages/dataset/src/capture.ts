import type {
  RecordingAsset,
  RecordingAssetRole,
  SessionManifest,
} from "../../contracts/src";

export interface CaptureHealthSignals {
  droppedVideoFrames: number;
  droppedAudioBuffers: number;
  encoderBackpressureEvents: number;
  diskFreeBytes: number;
  diskPressure: boolean;
}

export interface MasterCapturePlan {
  sessionId: string;
  negotiatedVideo: { width: number; height: number; frameRate: number };
  negotiatedAudio?: { sampleRate: number; channelCount: number };
  videoMonotonicStartUs: number;
  audioMonotonicStartUs?: number;
  relativeMasterVideoPath: string;
  relativeMasterAudioPath?: string;
}

export interface MasterCaptureResult {
  assets: RecordingAsset[];
  health: CaptureHealthSignals;
  status: "recording" | "incomplete" | "complete";
  recoveryNote?: string;
}

/** Build durable asset identities for master video/audio without writing bytes. */
export function planMasterAssets(
  plan: MasterCapturePlan,
  createdAt: string,
): RecordingAsset[] {
  const assets: RecordingAsset[] = [
    {
      id: `${plan.sessionId}-master-video`,
      sessionId: plan.sessionId,
      role: "master_video",
      relativePath: plan.relativeMasterVideoPath,
      mimeType: "video/quicktime",
      byteLength: 0,
      validationState: "pending",
      immutable: true,
      createdAt,
      monotonicStartUs: plan.videoMonotonicStartUs,
      codec: `${plan.negotiatedVideo.width}x${plan.negotiatedVideo.height}@${plan.negotiatedVideo.frameRate}`,
    },
  ];
  if (plan.relativeMasterAudioPath && plan.audioMonotonicStartUs !== undefined) {
    assets.push({
      id: `${plan.sessionId}-master-audio`,
      sessionId: plan.sessionId,
      role: "master_audio",
      relativePath: plan.relativeMasterAudioPath,
      mimeType: "audio/wav",
      byteLength: 0,
      validationState: "pending",
      immutable: true,
      createdAt,
      monotonicStartUs: plan.audioMonotonicStartUs,
      codec: plan.negotiatedAudio
        ? `${plan.negotiatedAudio.sampleRate}Hz/${plan.negotiatedAudio.channelCount}ch`
        : undefined,
    });
  }
  return assets;
}

export function applyCaptureBytes(
  asset: RecordingAsset,
  byteLength: number,
  sha256: string,
  durationUs: number,
): RecordingAsset {
  if (!asset.immutable && asset.role.startsWith("master")) {
    throw new Error("Master assets must be marked immutable");
  }
  return {
    ...asset,
    byteLength,
    sha256,
    durationUs,
    validationState: byteLength > 0 ? "valid" : "incomplete",
  };
}

export function captureHealthDegraded(health: CaptureHealthSignals): boolean {
  return (
    health.diskPressure ||
    health.droppedVideoFrames > 30 ||
    health.encoderBackpressureEvents > 5
  );
}

export function sessionPaths(sessionId: string): {
  root: string;
  masterVideo: string;
  masterAudio: string;
  proxy: string;
  analysisAudio: string;
  recovery: string;
} {
  const root = `sessions/${sessionId}`;
  return {
    root,
    masterVideo: `${root}/master/video.mov`,
    masterAudio: `${root}/master/audio.wav`,
    proxy: `${root}/proxy/review.mp4`,
    analysisAudio: `${root}/proxy/analysis-mono.wav`,
    recovery: `${root}/recovery`,
  };
}

export function stampNegotiatedCapture(
  manifest: SessionManifest,
  negotiated: {
    width: number;
    height: number;
    frameRate: number;
  },
): SessionManifest {
  return {
    ...manifest,
    recoveryNote:
      manifest.recoveryNote ??
      `Negotiated capture ${negotiated.width}x${negotiated.height}@${negotiated.frameRate}`,
  };
}

export function isMasterRole(role: RecordingAssetRole): boolean {
  return role === "master_video" || role === "master_audio";
}
