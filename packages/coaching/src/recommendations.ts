import type {
  DrillDefinition,
  RecommendationFeedback,
} from "../../contracts/src";
import type { ProgressSessionInput, SessionTrendPoint } from "./progress";
import { computeSessionTrendPoint } from "./progress";
import { loadBuiltinDrills } from "./drills";

export const RECOMMENDATION_RULES_VERSION = "recommend-rules/1.0.0";

export type RecommendationAction =
  | "drill"
  | "recalibrate"
  | "rest"
  | "keep_practicing";

export interface Recommendation {
  id: string;
  action: RecommendationAction;
  drillId?: string;
  title: string;
  reason: string;
  rulesVersion: string;
  evidence: string[];
  pinned?: boolean;
  dismissed?: boolean;
  followed?: boolean;
  useful?: boolean;
}

export interface RecommendationContext {
  latest: ProgressSessionInput;
  /** Optional trend point override (tests). */
  trend?: SessionTrendPoint;
  availableDrills?: DrillDefinition[];
  /** Minimum scored frames before recommending harder work. */
  minEvidenceFrames?: number;
  /** Unknown ratio above this → recalibrate. */
  poorTrackingUnknownRatio?: number;
  /** Mean confidence below this → recalibrate. */
  poorTrackingConfidence?: number;
}

function findDrill(
  drills: DrillDefinition[],
  predicate: (drill: DrillDefinition) => boolean,
): DrillDefinition | undefined {
  return drills.find(predicate);
}

/**
 * Deterministic next-drill recommendations with explicit reasons.
 * Poor tracking never escalates difficulty.
 */
export function recommendNext(context: RecommendationContext): Recommendation {
  const drills = context.availableDrills ?? loadBuiltinDrills();
  const trend = context.trend ?? computeSessionTrendPoint(context.latest);
  const minFrames = context.minEvidenceFrames ?? 30;
  const unknownCap = context.poorTrackingUnknownRatio ?? 0.2;
  const confidenceFloor = context.poorTrackingConfidence ?? 0.5;
  const evidence: string[] = [
    `unknown_ratio=${trend.unknownRatio.toFixed(3)}`,
    `tracking_confidence=${trend.trackingConfidence.toFixed(3)}`,
    `frames=${context.latest.predictions.length}`,
  ];

  if (
    trend.measurementDegraded ||
    trend.unknownRatio > unknownCap ||
    trend.trackingConfidence < confidenceFloor
  ) {
    return {
      id: "recalibrate-tracking",
      action: "recalibrate",
      title: "Recalibrate before harder drills",
      reason:
        "Tracking quality is too weak to trust coaching metrics. Recalibrate the camera profile instead of increasing drill difficulty.",
      rulesVersion: RECOMMENDATION_RULES_VERSION,
      evidence: [
        ...evidence,
        "rule=poor_tracking",
        trend.measurementDegraded ? "measurement_degraded=true" : "measurement_degraded=false",
      ],
    };
  }

  if (context.latest.predictions.length < minFrames) {
    return {
      id: "need-more-evidence",
      action: "keep_practicing",
      drillId: context.latest.manifest.coaching?.drillId,
      title: "Repeat the same drill for clearer evidence",
      reason:
        "There is not enough scored evidence yet for a targeted next drill. Repeat the current drill under similar conditions.",
      rulesVersion: RECOMMENDATION_RULES_VERSION,
      evidence: [...evidence, `min_frames=${minFrames}`, "rule=min_evidence"],
    };
  }

  const breaksPerMinute = trend.breaksPerMinute ?? 0;
  const medianBreakMs = trend.medianBreakMs ?? 0;
  const contact = trend.contactDuringSpeaking ?? 0;
  evidence.push(
    `breaks_per_min=${breaksPerMinute.toFixed(2)}`,
    `median_break_ms=${medianBreakMs.toFixed(0)}`,
    `contact_ratio=${contact.toFixed(3)}`,
  );

  if (medianBreakMs >= 2000 && breaksPerMinute >= 2) {
    const notesDrill =
      findDrill(drills, (drill) => drill.id.includes("presentation") || drill.mode === "presentation_rehearsal") ??
      findDrill(drills, (drill) => drill.curriculumLevel === 4);
    return {
      id: "return-from-notes",
      action: "drill",
      drillId: notesDrill?.id,
      title: notesDrill?.name ?? "Practice returning from notes",
      reason:
        "Your contact was interrupted by long downward breaks. The next drill practices checking notes and returning before the next sentence.",
      rulesVersion: RECOMMENDATION_RULES_VERSION,
      evidence: [...evidence, "rule=long_note_breaks"],
    };
  }

  if (contact >= 0.75 && medianBreakMs >= 1500) {
    const recoveryDrill =
      findDrill(drills, (drill) => drill.mode === "simulated_livestream") ??
      findDrill(drills, (drill) => drill.curriculumLevel === 5);
    return {
      id: "rapid-recovery",
      action: "drill",
      drillId: recoveryDrill?.id,
      title: recoveryDrill?.name ?? "Rapid recovery drill",
      reason:
        "Contact ratio is strong, but the longest breaks are still extended. Practice acknowledging interruptions and recovering quickly.",
      rulesVersion: RECOMMENDATION_RULES_VERSION,
      evidence: [...evidence, "rule=long_breaks_high_contact"],
    };
  }

  if (contact < 0.55) {
    const comfort =
      findDrill(drills, (drill) => drill.mode === "lens_comfort") ??
      findDrill(drills, (drill) => drill.curriculumLevel === 1);
    return {
      id: "lens-comfort",
      action: "drill",
      drillId: comfort?.id,
      title: comfort?.name ?? "Return to lens comfort",
      reason:
        "Contact during speaking is still low. Stay with a calmer lens-comfort drill rather than escalating.",
      rulesVersion: RECOMMENDATION_RULES_VERSION,
      evidence: [...evidence, "rule=low_contact"],
    };
  }

  const currentLevel = context.latest.manifest.coaching?.curriculumLevel ?? 1;
  const next =
    findDrill(drills, (drill) => drill.curriculumLevel === Math.min(6, currentLevel + 1)) ??
    findDrill(drills, (drill) => drill.id === context.latest.manifest.coaching?.drillId);

  return {
    id: "progress-next-level",
    action: "drill",
    drillId: next?.id,
    title: next?.name ?? "Continue progressive practice",
    reason:
      "Metrics look stable enough to continue the curriculum. Advance one level or repeat the current drill if you want more reps.",
    rulesVersion: RECOMMENDATION_RULES_VERSION,
    evidence: [...evidence, "rule=stable_progress"],
  };
}

export function applyRecommendationFeedback(
  recommendation: Recommendation,
  feedback: { dismissed?: boolean; pinned?: boolean; followed?: boolean; useful?: boolean },
): Recommendation {
  return { ...recommendation, ...feedback };
}

/**
 * A recommendation can be judged useful only after a session actually records
 * that it was followed. Following it is not itself positive feedback.
 */
export function recommendationAwaitingUsefulness(
  feedback: RecommendationFeedback[],
  completedFollowedRecommendationIds: Iterable<string>,
): RecommendationFeedback | undefined {
  const completed = new Set(completedFollowedRecommendationIds);
  return [...feedback]
    .filter(
      (entry) =>
        entry.followed === true &&
        entry.useful === undefined &&
        completed.has(entry.recommendationId),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
