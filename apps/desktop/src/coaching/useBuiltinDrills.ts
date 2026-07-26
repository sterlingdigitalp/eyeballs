import { useMemo } from "react";
import type { DrillDefinition } from "../../../../packages/contracts/src";
import { loadBuiltinDrills } from "../../../../packages/coaching/src";

export function useBuiltinDrills(): DrillDefinition[] {
  return useMemo(() => loadBuiltinDrills(), []);
}
