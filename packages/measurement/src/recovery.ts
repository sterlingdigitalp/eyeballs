import type { FeatureVector, SessionManifest } from "../../contracts/src";

interface RecoverableSession {
  manifest: SessionManifest;
  features?: FeatureVector[];
}

export function recoverInterruptedSession<T extends RecoverableSession>(session: T): {
  session: T & { features: FeatureVector[] };
  changed: boolean;
} {
  const normalized = { ...session, features: session.features ?? [] };
  if (session.manifest.status !== "recording" && session.manifest.status !== "finalizing") {
    return { session: normalized, changed: false };
  }
  return {
    changed: true,
    session: {
      ...normalized,
      manifest: {
        ...session.manifest,
        status: "incomplete",
        recoveryNote:
          "The application stopped before finalization. Preserved tracking checkpoints remain reviewable.",
      },
    },
  };
}

export function recordingFinalization(
  requestedRecording: boolean,
  mediaByteLength: number,
  captureError?: string,
): { status: "complete" | "incomplete"; recoveryNote?: string } {
  if (captureError) return { status: "incomplete", recoveryNote: captureError };
  if (requestedRecording && mediaByteLength === 0) {
    return {
      status: "incomplete",
      recoveryNote: "The recorder produced no media bytes; tracking checkpoints were preserved.",
    };
  }
  return { status: "complete" };
}
