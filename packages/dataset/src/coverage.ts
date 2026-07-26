import type { ClipCandidate, ClipLabel } from "../../contracts/src";

export const coverageDimensions = {
  deliveryStyle: [
    "neutral",
    "conversational",
    "explanatory",
    "persuasive",
    "enthusiastic",
    "serious",
    "reflective",
    "urgent",
    "warm_greeting",
    "call_to_action",
  ],
  speech: [
    "slow",
    "normal",
    "fast",
    "short_sentence",
    "long_sentence",
    "question",
    "numbers",
    "names",
    "soft",
    "emphatic",
  ],
  visualMotion: [
    "neutral_pose",
    "head_turn",
    "nod",
    "eyebrow",
    "smile",
    "listening",
    "thinking_pause",
    "gesture",
    "blink_natural",
  ],
  captureContext: [
    "macbook_practice",
    "studio_capture",
    "glasses_on",
    "glasses_off",
    "outfit_a",
    "outfit_b",
    "bg_plain",
    "bg_bookshelf",
    "lighting_soft",
    "lighting_hard",
  ],
} as const;

export type CoverageDimension = keyof typeof coverageDimensions;

export interface CoverageTaggedClip {
  clip: ClipCandidate;
  tags: string[];
}

export interface CoverageReport {
  counts: Record<string, number>;
  missing: string[];
  overrepresented: string[];
  fragile: string[];
}

const datasetLabels: ClipLabel[] = ["excellent", "usable"];

export function buildCoverageReport(
  items: CoverageTaggedClip[],
  options: { overrepresentedThreshold?: number } = {},
): CoverageReport {
  const threshold = options.overrepresentedThreshold ?? 5;
  const counts: Record<string, number> = {};
  const allTags = Object.values(coverageDimensions).flat();
  for (const tag of allTags) counts[tag] = 0;

  for (const item of items) {
    if (item.clip.label && !datasetLabels.includes(item.clip.label)) continue;
    if (!item.clip.label) continue;
    for (const tag of item.tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }

  const missing = allTags.filter((tag) => (counts[tag] ?? 0) === 0);
  const overrepresented = allTags.filter((tag) => (counts[tag] ?? 0) >= threshold);
  const fragile = allTags.filter((tag) => (counts[tag] ?? 0) === 1);

  return { counts, missing, overrepresented, fragile };
}
