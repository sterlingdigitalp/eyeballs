import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { invoke } from "@tauri-apps/api/core";
import type {
  Calibration,
  CaptureProfile,
  Correction,
  GazeEvent,
  GazePrediction,
  SessionManifest,
  FeatureVector,
} from "../../../../packages/contracts/src";
import {
  calibrationSchema,
  captureProfileSchema,
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
};
