import {
  featureFlagsSchema,
  type FeatureFlags,
} from "../../../../packages/contracts/src";

export const DEFAULT_FEATURE_FLAGS: Readonly<FeatureFlags> = Object.freeze({
  experimentalTrackerComparison: false,
});

export function parseFeatureFlags(value: unknown): FeatureFlags {
  const result = featureFlagsSchema.safeParse(value);
  return result.success ? result.data : { ...DEFAULT_FEATURE_FLAGS };
}
