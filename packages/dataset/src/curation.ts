import { clipLabels, type ClipCandidate, type ClipLabel } from "../../contracts/src";

export function isClipLabel(value: string): value is ClipLabel {
  return (clipLabels as readonly string[]).includes(value);
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
  if (endUs <= startUs) throw new Error("Invalid range");
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
