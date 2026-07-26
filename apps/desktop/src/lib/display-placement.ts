import type {
  CaptureProfile,
  PromptDisplayPlacement,
} from "../../../../packages/contracts/src";

export interface MonitorGeometry {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
}

export function promptDisplayFromMonitor(
  monitor: MonitorGeometry,
): PromptDisplayPlacement {
  return {
    name: monitor.name || undefined,
    positionX: monitor.position.x,
    positionY: monitor.position.y,
    width: monitor.size.width,
    height: monitor.size.height,
    scaleFactor: monitor.scaleFactor,
  };
}

export function promptDisplayLabel(
  display: PromptDisplayPlacement,
): string {
  return display.name
    ? `${display.name} (${display.width}×${display.height})`
    : `${display.width}×${display.height} display at ${display.positionX},${display.positionY}`;
}

export function isSamePromptDisplay(
  expected: PromptDisplayPlacement,
  current: PromptDisplayPlacement,
): boolean {
  return (
    expected.name === current.name &&
    expected.positionX === current.positionX &&
    expected.positionY === current.positionY &&
    expected.width === current.width &&
    expected.height === current.height &&
    expected.scaleFactor === current.scaleFactor
  );
}

/**
 * Warn instead of silently trusting a lens-relative prompt after the app moves
 * to another display. Browser development has no monitor identity and returns
 * no warning; the Tauri app supplies currentDisplay.
 */
export function promptPlacementIssue(
  profile: CaptureProfile | undefined,
  currentDisplay: PromptDisplayPlacement | undefined,
): string | undefined {
  if (!profile || !currentDisplay) return undefined;
  if (!profile.promptDisplay) {
    return "Prompt display is not bound yet. In Setup, place this window on the monitor beneath the camera and click the lens anchor once.";
  }
  if (isSamePromptDisplay(profile.promptDisplay, currentDisplay)) {
    return undefined;
  }
  return `Prompt placement was aligned on ${promptDisplayLabel(profile.promptDisplay)}, but this window is on ${promptDisplayLabel(currentDisplay)}. Move it back or re-save the lens anchor in Setup.`;
}
