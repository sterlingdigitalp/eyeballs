import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURE_FLAGS, parseFeatureFlags } from "./feature-flags";

describe("feature flags", () => {
  it("keeps experimental tracker comparison disabled by default", () => {
    expect(parseFeatureFlags(undefined)).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(parseFeatureFlags({ experimentalTrackerComparison: "yes" })).toEqual(
      DEFAULT_FEATURE_FLAGS,
    );
  });

  it("accepts an explicit persisted opt-in", () => {
    expect(parseFeatureFlags({ experimentalTrackerComparison: true })).toEqual({
      experimentalTrackerComparison: true,
    });
  });
});
