import { clipLabels, type ClipCandidate, type ClipLabel } from "../../contracts/src";

export const curationReasonTags = [
  "weak_contact",
  "unnatural_expression",
  "verbal_mistake",
  "audio_noise",
  "clipping",
  "focus_exposure_issue",
  "duplicate",
  "unwanted_outfit_background",
  "privacy_sensitive",
  "interrupted",
  "poor_sync",
  "not_representative",
] as const;
export type CurationReasonTag = (typeof curationReasonTags)[number];

export function isClipLabel(value: string): value is ClipLabel {
  return (clipLabels as readonly string[]).includes(value);
}

export function toggleClipReasonTag(
  clip: ClipCandidate,
  tag: CurationReasonTag,
): ClipCandidate {
  if (!curationReasonTags.includes(tag)) {
    throw new Error(`Invalid curation reason tag: ${tag}`);
  }
  const reasonTags = clip.reasonTags.includes(tag)
    ? clip.reasonTags.filter((existing) => existing !== tag)
    : [...clip.reasonTags, tag];
  return {
    ...clip,
    reasonTags,
    proposedBy: "human",
  };
}

export function labelClip(
  clip: ClipCandidate,
  label: ClipLabel,
  reasonTags: string[] = [],
): ClipCandidate {
  if (!isClipLabel(label)) {
    throw new Error(`Invalid clip label: ${label}`);
  }
  return {
    ...clip,
    label,
    reasonTags: [...new Set([...clip.reasonTags, ...reasonTags])],
    proposedBy: clip.proposedBy === "auto" ? "human" : clip.proposedBy,
  };
}

export function adjustClipBoundary(
  clip: ClipCandidate,
  startUs: number,
  endUs: number,
): ClipCandidate {
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(endUs)) {
    throw new Error("Clip boundaries must be finite integer microseconds");
  }
  if (endUs <= startUs) {
    throw new Error("Clip endUs must be greater than startUs");
  }
  if (startUs < 0) {
    throw new Error("Clip startUs must be non-negative");
  }
  return {
    ...clip,
    startUs,
    endUs,
    pointsIntoMaster: true,
    proposedBy: "human",
  };
}

export function createHumanClip(
  sessionId: string,
  startUs: number,
  endUs: number,
  label?: ClipLabel,
): ClipCandidate {
  if (
    !Number.isSafeInteger(startUs) ||
    !Number.isSafeInteger(endUs) ||
    startUs < 0 ||
    endUs <= startUs
  ) {
    throw new Error("Invalid range");
  }
  return {
    id: `${sessionId}-human-${startUs}-${endUs}`,
    sessionId,
    startUs,
    endUs,
    label,
    reasonTags: [],
    proposedBy: "human",
    pointsIntoMaster: true,
  };
}

/** Keyboard-friendly curation actions used by UI bindings. */
export type CurationKeyAction =
  | "label_excellent"
  | "label_usable"
  | "label_coaching_only"
  | "label_rejected"
  | "label_delete"
  | "nudge_start_left"
  | "nudge_start_right"
  | "nudge_end_left"
  | "nudge_end_right";

export function applyCurationKey(
  clip: ClipCandidate,
  action: CurationKeyAction,
  nudgeUs = 100_000,
): ClipCandidate {
  switch (action) {
    case "label_excellent":
      return labelClip(clip, "excellent");
    case "label_usable":
      return labelClip(clip, "usable");
    case "label_coaching_only":
      return labelClip(clip, "coaching_only");
    case "label_rejected":
      return labelClip(clip, "rejected", ["human_rejected"]);
    case "label_delete":
      return labelClip(clip, "delete", ["human_delete"]);
    case "nudge_start_left":
      return adjustClipBoundary(clip, Math.max(0, clip.startUs - nudgeUs), clip.endUs);
    case "nudge_start_right":
      return adjustClipBoundary(
        clip,
        Math.min(clip.endUs - 1, clip.startUs + nudgeUs),
        clip.endUs,
      );
    case "nudge_end_left":
      return adjustClipBoundary(
        clip,
        clip.startUs,
        Math.max(clip.startUs + 1, clip.endUs - nudgeUs),
      );
    case "nudge_end_right":
      return adjustClipBoundary(clip, clip.startUs, clip.endUs + nudgeUs);
    default:
      return clip;
  }
}

export function allClipLabels(): ClipLabel[] {
  return [...clipLabels];
}
