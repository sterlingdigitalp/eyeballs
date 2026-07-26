import type { StoredSession } from "./store";
import {
  calibrationSchema,
  correctionSchema,
  cueEventSchema,
  featureVectorSchema,
  gazeEventSchema,
  gazePredictionSchema,
  reviewBookmarkSchema,
  reviewClipSchema,
  sessionManifestSchema,
  speakingWindowSchema,
  transcriptDocumentSchema,
} from "../../../../packages/contracts/src";
import { z } from "zod";

const storedSessionSchema = z.object({
  manifest: sessionManifestSchema,
  calibrationSnapshot: calibrationSchema.optional(),
  features: z.array(featureVectorSchema),
  predictions: z.array(gazePredictionSchema),
  events: z.array(gazeEventSchema),
  corrections: z.array(correctionSchema),
  bookmarks: z.array(reviewBookmarkSchema).optional(),
  reviewClips: z.array(reviewClipSchema).optional(),
  cues: z.array(cueEventSchema).optional(),
  speakingWindows: z.array(speakingWindowSchema).optional(),
  transcript: transcriptDocumentSchema.optional(),
  correctedTranscript: transcriptDocumentSchema.optional(),
  transcriptRevisions: z.array(transcriptDocumentSchema).optional(),
  media: z.instanceof(Blob).optional(),
});

export function parseStoredSession(value: unknown): StoredSession | undefined {
  const parsed = storedSessionSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const manifestValue =
    value && typeof value === "object" && "manifest" in value
      ? (value as { manifest: unknown }).manifest
      : undefined;
  const manifest = sessionManifestSchema.safeParse(manifestValue);
  if (!manifest.success) {
    console.error("Discarded a stored session with an unreadable manifest.");
    return undefined;
  }
  console.error(
    `Recovered session ${manifest.data.id} as invalid because its stored evidence failed schema validation.`,
  );
  return {
    manifest: {
      ...manifest.data,
      status: "invalid",
      recoveryNote:
        "Stored session evidence failed schema validation. The readable manifest was preserved.",
    },
    features: [],
    predictions: [],
    events: [],
    corrections: [],
  };
}

export function parseStoredSessions(values: unknown[]): StoredSession[] {
  return values
    .map(parseStoredSession)
    .filter((value): value is StoredSession => value !== undefined);
}

export class SessionWriteQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(write: () => Promise<void>): Promise<void> {
    const next = this.tail.then(write, write);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

const statusRank: Record<StoredSession["manifest"]["status"], number> = {
  recording: 0,
  finalizing: 1,
  incomplete: 2,
  invalid: 2,
  complete: 3,
};

const preferredCheckpoint = (
  first: StoredSession,
  second: StoredSession,
): StoredSession => {
  const statusDifference =
    statusRank[first.manifest.status] - statusRank[second.manifest.status];
  if (statusDifference !== 0) return statusDifference > 0 ? first : second;
  return first.manifest.frameCount >= second.manifest.frameCount ? first : second;
};

const longer = <T>(first: T[], second: T[]): T[] =>
  first.length >= second.length ? first : second;

const optionalLonger = <T>(
  first: T[] | undefined,
  second: T[] | undefined,
): T[] | undefined => {
  if (!first) return second;
  if (!second) return first;
  return longer(first, second);
};

const preferredTranscript = <T extends {
  updatedAt?: string;
}>(
  browser: T | undefined,
  native: T | undefined,
): T | undefined => {
  if (!browser) return native;
  if (!native) return browser;
  if (browser.updatedAt && native.updatedAt) {
    return browser.updatedAt >= native.updatedAt ? browser : native;
  }
  // Writes reach browser storage before the native mirror, so browser is the
  // recoverable source of truth if one side lacks a revision timestamp.
  return browser;
};

const transcriptRevisionKey = (revision: {
  updatedAt?: string;
  words: Array<{ text: string; startUs: number; endUs: number }>;
  sentences: Array<{
    index: number;
    text: string;
    startUs: number;
    endUs: number;
  }>;
}): string =>
  JSON.stringify({
    updatedAt: revision.updatedAt,
    words: revision.words,
    sentences: revision.sentences,
  });

const mergeTranscriptRevisions = (
  browser: StoredSession["transcriptRevisions"],
  native: StoredSession["transcriptRevisions"],
): StoredSession["transcriptRevisions"] => {
  if (!browser) return native;
  if (!native) return browser;
  const revisions = new Map(
    [...native, ...browser].map((revision) => [
      transcriptRevisionKey(revision),
      revision,
    ]),
  );
  return [...revisions.values()].sort((first, second) =>
    (first.updatedAt ?? "").localeCompare(second.updatedAt ?? ""),
  );
};

export function appendTranscriptRevision(
  session: StoredSession,
  corrected: NonNullable<StoredSession["correctedTranscript"]>,
): StoredSession {
  if (corrected.origin !== "user_corrected") {
    throw new Error("Transcript revision must be user-corrected");
  }
  return {
    ...session,
    correctedTranscript: corrected,
    transcriptRevisions: [
      ...(session.transcriptRevisions ?? []),
      corrected,
    ],
  };
}

export function mergeStoredSessions(
  browserSessions: StoredSession[],
  nativeSessions: StoredSession[] = [],
): StoredSession[] {
  const browserById = new Map(
    browserSessions.map((session) => [session.manifest.id, session]),
  );
  const nativeById = new Map(
    nativeSessions.map((session) => [session.manifest.id, session]),
  );
  const ids = new Set([...browserById.keys(), ...nativeById.keys()]);
  return [...ids].map((id) => {
    const browser = browserById.get(id);
    const native = nativeById.get(id);
    if (!browser) return native!;
    if (!native) return browser;
    const preferred = preferredCheckpoint(browser, native);
    return {
      ...preferred,
      features: longer(browser.features, native.features),
      predictions: longer(browser.predictions, native.predictions),
      events: longer(browser.events, native.events),
      corrections: longer(browser.corrections, native.corrections),
      bookmarks: optionalLonger(browser.bookmarks, native.bookmarks),
      reviewClips: optionalLonger(browser.reviewClips, native.reviewClips),
      cues: optionalLonger(browser.cues, native.cues),
      speakingWindows: optionalLonger(
        browser.speakingWindows,
        native.speakingWindows,
      ),
      transcript: preferredTranscript(browser.transcript, native.transcript),
      correctedTranscript: preferredTranscript(
        browser.correctedTranscript,
        native.correctedTranscript,
      ),
      transcriptRevisions: mergeTranscriptRevisions(
        browser.transcriptRevisions,
        native.transcriptRevisions,
      ),
      calibrationSnapshot:
        browser.calibrationSnapshot ?? native.calibrationSnapshot,
      media: browser.media ?? native.media,
    };
  }).sort((a, b) => b.manifest.startedAt.localeCompare(a.manifest.startedAt));
}
