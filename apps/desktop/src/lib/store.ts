import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { invoke } from "@tauri-apps/api/core";
import type {
  Calibration,
  CaptureProfile,
  ClipCandidate,
  ConsentRecord,
  Correction,
  CueEvent,
  DrillDefinition,
  GazeEvent,
  GazePrediction,
  RecommendationFeedback,
  ReviewBookmark,
  SessionManifest,
  FeatureVector,
  SpeakingWindowRecord,
  TranscriptDocument,
} from "../../../../packages/contracts/src";
import {
  calibrationSchema,
  captureProfileSchema,
  clipCandidateSchema,
  consentRecordSchema,
  drillDefinitionSchema,
  recommendationFeedbackSchema,
} from "../../../../packages/contracts/src";
import {
  mergeStoredSessions,
  parseStoredSession,
  parseStoredSessions,
  SessionWriteQueue,
} from "./session-store";
import { mergeRecordsById, parseRecordList } from "./record-validation";

export interface StoredSession {
  manifest: SessionManifest;
  calibrationSnapshot?: Calibration;
  features: FeatureVector[];
  predictions: GazePrediction[];
  events: GazeEvent[];
  corrections: Correction[];
  bookmarks?: ReviewBookmark[];
  cues?: CueEvent[];
  speakingWindows?: SpeakingWindowRecord[];
  /** Immutable model/stub transcript evidence. */
  transcript?: TranscriptDocument;
  /** User-corrected words and/or sentence boundaries. */
  correctedTranscript?: TranscriptDocument;
  media?: Blob;
}

interface CoachDatabase extends DBSchema {
  profiles: { key: string; value: CaptureProfile };
  calibrations: { key: string; value: Calibration; indexes: { byProfile: string } };
  sessions: { key: string; value: StoredSession };
  settings: { key: string; value: unknown };
}

let database: Promise<IDBPDatabase<CoachDatabase>> | undefined;
const sessionWriteQueue = new SessionWriteQueue();
const isTauri = () => "__TAURI_INTERNALS__" in window;

async function nativePut(bucket: string, key: string, value: unknown): Promise<void> {
  if (isTauri()) await invoke("persist_json", { bucket, key, value });
}

async function nativeList<T>(bucket: string): Promise<T[] | undefined> {
  if (!isTauri()) return undefined;
  try {
    return await invoke<T[]>("list_json", { bucket });
  } catch (cause) {
    console.error(
      `Native ${bucket} records could not be read; falling back to browser storage: ${String(cause)}`,
    );
    return undefined;
  }
}

async function nativeGet<T>(bucket: string, key: string): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  try {
    return (await invoke<T | null>("load_json", { bucket, key })) ?? undefined;
  } catch (cause) {
    console.error(
      `Native ${bucket}/${key} could not be read; falling back to browser storage: ${String(cause)}`,
    );
    return undefined;
  }
}

function db(): Promise<IDBPDatabase<CoachDatabase>> {
  database ??= openDB<CoachDatabase>("camera-presence-coach", 1, {
    upgrade(store) {
      if (!store.objectStoreNames.contains("profiles")) store.createObjectStore("profiles", { keyPath: "id" });
      if (!store.objectStoreNames.contains("calibrations")) {
        const calibrations = store.createObjectStore("calibrations", { keyPath: "id" });
        calibrations.createIndex("byProfile", "profileId");
      }
      if (!store.objectStoreNames.contains("sessions")) store.createObjectStore("sessions", { keyPath: "manifest.id" });
      if (!store.objectStoreNames.contains("settings")) store.createObjectStore("settings");
    },
  });
  return database;
}

const SETTINGS_CONSENTS = "consents";
const SETTINGS_CLIPS = "datasetClips";
const SETTINGS_RECOMMENDATIONS = "recommendationFeedback";
const SETTINGS_DATASET_VERSIONS = "datasetVersions";
const SETTINGS_CUSTOM_DRILLS = "customDrills";

export const store = {
  profiles: {
    all: async () => {
      const [browser, native] = await Promise.all([
        (await db()).getAll("profiles"),
        nativeList<unknown>("profiles"),
      ]);
      return mergeRecordsById(
        parseRecordList(captureProfileSchema, browser, "browser profile"),
        parseRecordList(captureProfileSchema, native ?? [], "native profile"),
        (browserProfile, nativeProfile) =>
          browserProfile.updatedAt >= nativeProfile.updatedAt,
      );
    },
    put: async (profile: CaptureProfile) => {
      await (await db()).put("profiles", profile);
      await nativePut("profiles", profile.id, profile);
    },
  },
  calibrations: {
    forProfile: async (profileId: string) => {
      const [browser, native] = await Promise.all([
        (await db()).getAllFromIndex("calibrations", "byProfile", profileId),
        nativeList<unknown>("calibrations"),
      ]);
      return mergeRecordsById(
        parseRecordList(calibrationSchema, browser, "browser calibration"),
        parseRecordList(calibrationSchema, native ?? [], "native calibration"),
      )
        .filter((calibration) => calibration.profileId === profileId);
    },
    put: async (calibration: Calibration) => {
      await (await db()).put("calibrations", calibration);
      await nativePut("calibrations", calibration.id, calibration);
    },
  },
  sessions: {
    all: async () => {
      const [browser, native] = await Promise.all([
        (await db()).getAll("sessions"),
        nativeList<StoredSession>("sessions"),
      ]);
      return mergeStoredSessions(
        parseStoredSessions(browser),
        parseStoredSessions(native ?? []),
      );
    },
    get: async (id: string) => {
      const [browser, native] = await Promise.all([
        (await db()).get("sessions", id),
        nativeGet<StoredSession>("sessions", id),
      ]);
      const parsedBrowser = browser ? parseStoredSession(browser) : undefined;
      const parsedNative = native ? parseStoredSession(native) : undefined;
      return mergeStoredSessions(
        parsedBrowser ? [parsedBrowser] : [],
        parsedNative ? [parsedNative] : [],
      )[0];
    },
    put: async (session: StoredSession) => {
      await sessionWriteQueue.enqueue(async () => {
        await (await db()).put("sessions", session);
        await nativePut("sessions", session.manifest.id, {
          ...session,
          media: undefined,
        });
      });
    },
  },
  settings: {
    get: async <T>(key: string) =>
      (await nativeGet<T>("settings", key)) ?? ((await db()).get("settings", key) as Promise<T | undefined>),
    put: async (key: string, value: unknown) => {
      await (await db()).put("settings", value, key);
      await nativePut("settings", key, value);
    },
  },
  customDrills: {
    all: async (): Promise<DrillDefinition[]> => {
      const raw =
        (await nativeGet<unknown[]>(SETTINGS_CUSTOM_DRILLS, "all")) ??
        (await store.settings.get<unknown[]>(SETTINGS_CUSTOM_DRILLS)) ??
        [];
      return parseRecordList(drillDefinitionSchema, raw, "custom drill");
    },
    putAll: async (drills: DrillDefinition[]) => {
      await store.settings.put(SETTINGS_CUSTOM_DRILLS, drills);
      await nativePut(SETTINGS_CUSTOM_DRILLS, "all", drills);
    },
    upsert: async (drill: DrillDefinition) => {
      const existing = await store.customDrills.all();
      const next = [
        drill,
        ...existing.filter((entry) => entry.id !== drill.id),
      ];
      await store.customDrills.putAll(next);
      return next;
    },
  },
  consents: {
    all: async (): Promise<ConsentRecord[]> => {
      const raw =
        (await nativeGet<unknown[]>(SETTINGS_CONSENTS, "all")) ??
        (await store.settings.get<unknown[]>(SETTINGS_CONSENTS)) ??
        [];
      return parseRecordList(consentRecordSchema, raw, "consent");
    },
    putAll: async (records: ConsentRecord[]) => {
      await store.settings.put(SETTINGS_CONSENTS, records);
      await nativePut(SETTINGS_CONSENTS, "all", records);
    },
  },
  clips: {
    all: async (): Promise<ClipCandidate[]> => {
      const raw =
        (await nativeGet<unknown[]>(SETTINGS_CLIPS, "all")) ??
        (await store.settings.get<unknown[]>(SETTINGS_CLIPS)) ??
        [];
      return parseRecordList(clipCandidateSchema, raw, "clip");
    },
    putAll: async (clips: ClipCandidate[]) => {
      await store.settings.put(SETTINGS_CLIPS, clips);
      await nativePut(SETTINGS_CLIPS, "all", clips);
    },
  },
  recommendationFeedback: {
    all: async (): Promise<RecommendationFeedback[]> => {
      const raw =
        (await nativeGet<unknown[]>(SETTINGS_RECOMMENDATIONS, "all")) ??
        (await store.settings.get<unknown[]>(SETTINGS_RECOMMENDATIONS)) ??
        [];
      return parseRecordList(recommendationFeedbackSchema, raw, "recommendation");
    },
    putAll: async (records: RecommendationFeedback[]) => {
      await store.settings.put(SETTINGS_RECOMMENDATIONS, records);
      await nativePut(SETTINGS_RECOMMENDATIONS, "all", records);
    },
    upsert: async (record: RecommendationFeedback) => {
      const existing = await store.recommendationFeedback.all();
      const next = [
        record,
        ...existing.filter((entry) => entry.recommendationId !== record.recommendationId),
      ];
      await store.recommendationFeedback.putAll(next);
      return next;
    },
  },
  datasetVersions: {
    all: async (): Promise<unknown[]> => {
      return (
        (await nativeGet<unknown[]>(SETTINGS_DATASET_VERSIONS, "all")) ??
        (await store.settings.get<unknown[]>(SETTINGS_DATASET_VERSIONS)) ??
        []
      );
    },
    putAll: async (versions: unknown[]) => {
      await store.settings.put(SETTINGS_DATASET_VERSIONS, versions);
      await nativePut(SETTINGS_DATASET_VERSIONS, "all", versions);
    },
  },
};
