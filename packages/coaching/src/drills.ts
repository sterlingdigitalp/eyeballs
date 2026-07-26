import {
  curriculumLevels,
  drillDefinitionSchema,
  type CurriculumLevel,
  type DrillDefinition,
  type SessionCoaching,
  type SessionManifest,
  type FeedbackIntensity,
} from "../../contracts/src";

import level1 from "../content/drills/level1-relaxed-lens-hold.json";
import level1Greeting from "../content/drills/level1-greeting-introduction.json";
import level2 from "../content/drills/level2-lens-adjacent-reading.json";
import level2Finish from "../content/drills/level2-finish-sentence-through-lens.json";
import level3 from "../content/drills/level3-prompted-response.json";
import level4 from "../content/drills/level4-presentation-rehearsal.json";
import level4Notes from "../content/drills/level4-notes-and-recover.json";
import level5 from "../content/drills/level5-simulated-livestream.json";
import level5Review from "../content/drills/level5-review-only-rehearsal.json";
import level6 from "../content/drills/level6-live-assist.json";

export const SCORING_POLICY_VERSION = "coaching-scoring/1.0.0";

export class DrillValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "DrillValidationError";
    this.issues = issues;
  }
}

/** Validate a single drill definition from raw content. Rejects invalid content. */
export function parseDrillDefinition(raw: unknown): DrillDefinition {
  const parsed = drillDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new DrillValidationError("Invalid drill definition", issues);
  }
  const drill = parsed.data;
  if (drill.curriculumLevel < 1 || drill.curriculumLevel > 6) {
    throw new DrillValidationError("Invalid curriculum level", [
      `curriculumLevel must be 1–6, got ${drill.curriculumLevel}`,
    ]);
  }
  const expectedMode = curriculumLevels[drill.curriculumLevel - 1];
  if (drill.mode !== expectedMode) {
    throw new DrillValidationError("Drill mode does not match curriculum level", [
      `level ${drill.curriculumLevel} expects mode ${expectedMode}, got ${drill.mode}`,
    ]);
  }
  if (
    drill.contactPolicy.longBreakMinMs !== undefined &&
    drill.contactPolicy.longBreakMinMs < drill.contactPolicy.reportableBreakMinMs
  ) {
    throw new DrillValidationError("Invalid contact policy thresholds", [
      "longBreakMinMs must be >= reportableBreakMinMs",
    ]);
  }
  for (const interval of drill.noteAllowedIntervals) {
    if (interval.endSec <= interval.startSec) {
      throw new DrillValidationError("Invalid note-allowed interval", [
        `interval endSec (${interval.endSec}) must exceed startSec (${interval.startSec})`,
      ]);
    }
  }
  return drill;
}

export function drillVersionString(version: DrillDefinition["version"]): string {
  return String(version);
}

const BUILTIN_RAW: unknown[] = [
  level1,
  level1Greeting,
  level2,
  level2Finish,
  level3,
  level4,
  level4Notes,
  level5,
  level5Review,
  level6,
];

let cachedBuiltins: DrillDefinition[] | undefined;

/** Load and validate all built-in drill content files. Throws if any are invalid. */
export function loadBuiltinDrills(): DrillDefinition[] {
  if (cachedBuiltins) return cachedBuiltins;
  const drills = BUILTIN_RAW.map((raw) => parseDrillDefinition(raw));
  const ids = new Set<string>();
  for (const drill of drills) {
    if (ids.has(drill.id)) {
      throw new DrillValidationError("Duplicate drill id in built-in library", [drill.id]);
    }
    ids.add(drill.id);
  }
  cachedBuiltins = drills;
  return drills;
}

/** Reset cached builtins (tests only). */
export function resetBuiltinDrillCache(): void {
  cachedBuiltins = undefined;
}

export function getDrillById(id: string): DrillDefinition | undefined {
  return loadBuiltinDrills().find((drill) => drill.id === id);
}

export function drillsByCurriculumLevel(): Record<CurriculumLevel, DrillDefinition[]> {
  const grouped = Object.fromEntries(
    curriculumLevels.map((level) => [level, [] as DrillDefinition[]]),
  ) as Record<CurriculumLevel, DrillDefinition[]>;
  for (const drill of loadBuiltinDrills()) {
    grouped[drill.mode].push(drill);
  }
  return grouped;
}

/** Ensure every curriculum level has at least one complete drill. */
export function assertCurriculumCoverage(drills: DrillDefinition[] = loadBuiltinDrills()): void {
  const missing: CurriculumLevel[] = [];
  for (const level of curriculumLevels) {
    if (!drills.some((drill) => drill.mode === level)) {
      missing.push(level);
    }
  }
  if (missing.length) {
    throw new DrillValidationError("Curriculum incomplete", [
      `Missing drills for: ${missing.join(", ")}`,
    ]);
  }
}

export interface StampDrillOptions {
  feedbackIntensity?: FeedbackIntensity;
  sessionGoal?: string;
  comfortBefore?: number;
  liveAssist?: boolean;
}

/** Stamp drill identity/version and coaching metadata onto a session manifest. */
export function stampDrillOnSession(
  manifest: SessionManifest,
  drill: DrillDefinition,
  options: StampDrillOptions = {},
): SessionManifest {
  const coaching: SessionCoaching = {
    drillId: drill.id,
    drillVersion: drillVersionString(drill.version),
    curriculumLevel: drill.curriculumLevel,
    feedbackIntensity:
      options.feedbackIntensity ?? drill.contactPolicy.feedbackLevel,
    scoringPolicyVersion: SCORING_POLICY_VERSION,
    drillSnapshot: drill,
    sessionGoal: options.sessionGoal,
    comfortBefore: options.comfortBefore,
    liveAssist: options.liveAssist ?? drill.liveAssist,
  };
  return {
    ...manifest,
    coaching,
  };
}

/** Parse a user-authored plain-text or Markdown outline into a rehearsal drill draft. */
export function drillFromOutline(
  outline: string,
  overrides: Partial<Pick<DrillDefinition, "id" | "name" | "durationTargetSec">> = {},
): DrillDefinition {
  const lines = outline
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new DrillValidationError("Outline is empty", ["Provide at least one prompt line"]);
  }
  const durationTargetSec = overrides.durationTargetSec ?? 90;
  return parseDrillDefinition({
    id: overrides.id ?? `custom-outline-${Date.now()}`,
    version: 1,
    name: overrides.name ?? "Custom outline rehearsal",
    mode: "presentation_rehearsal",
    curriculumLevel: 4,
    durationTargetSec,
    prompt: {
      type: "outline",
      text: lines[0],
      phrases: lines,
      revealMode: "one_line",
      hideWhenSpeaking: false,
    },
    contactPolicy: {
      microGlanceToleranceMs: 500,
      reportableBreakMinMs: 1000,
      longBreakMinMs: 2200,
      contactRecoveryConfirmMs: 250,
      feedbackCooldownMs: 3000,
      feedbackLevel: "standard",
      noteAllowedNearLensMs: 1500,
    },
    scoring: {
      excludeFirstSec: 2,
      excludeLastSec: 1,
      sentenceBoundaryContact: true,
      speakingWindowsOnly: true,
    },
    noteAllowedIntervals: [],
    completion: {
      minimumSpeakingSec: Math.min(30, Math.round(durationTargetSec * 0.6)),
      minimumDurationSec: Math.min(45, Math.round(durationTargetSec * 0.75)),
    },
    reflection: ["Which outline beats pulled your eyes away?"],
    liveAssist: false,
    recordingDefault: "optional",
  });
}
