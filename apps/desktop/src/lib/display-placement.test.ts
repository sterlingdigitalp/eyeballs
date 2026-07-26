import { describe, expect, it } from "vitest";
import type {
  CaptureProfile,
  PromptDisplayPlacement,
} from "../../../../packages/contracts/src";
import {
  isSamePromptDisplay,
  promptDisplayFromMonitor,
  promptPlacementIssue,
} from "./display-placement";

const display: PromptDisplayPlacement = {
  name: "LG UltraFine",
  positionX: 0,
  positionY: 0,
  width: 3840,
  height: 2160,
  scaleFactor: 2,
};

const profile = (promptDisplay?: PromptDisplayPlacement): CaptureProfile => ({
  id: "studio",
  name: "Studio",
  kind: "studio_capture",
  cameraDeviceId: "brio",
  cameraLabel: "Logitech BRIO",
  microphoneDeviceId: "yeti",
  microphoneLabel: "Yeti",
  requestedVideo: { width: 1920, height: 1080, frameRate: 30 },
  lensAnchor: { x: 0.5, y: 0.015 },
  promptDisplay,
  updatedAt: "2026-07-26T12:00:00.000Z",
});

describe("display-aware prompt placement", () => {
  it("captures physical monitor geometry to disambiguate duplicate display names", () => {
    expect(
      promptDisplayFromMonitor({
        name: "M173LS-F",
        position: { x: -1920, y: 100 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      }),
    ).toEqual({
      name: "M173LS-F",
      positionX: -1920,
      positionY: 100,
      width: 1920,
      height: 1080,
      scaleFactor: 1,
    });
  });

  it("requires name, bounds, and scale to match", () => {
    expect(isSamePromptDisplay(display, { ...display })).toBe(true);
    expect(
      isSamePromptDisplay(display, { ...display, positionX: 3840 }),
    ).toBe(false);
  });

  it("warns when unbound or moved and clears on the aligned display", () => {
    expect(promptPlacementIssue(profile(), display)).toMatch(/not bound/);
    expect(promptPlacementIssue(profile(display), display)).toBeUndefined();
    expect(
      promptPlacementIssue(
        profile(display),
        { ...display, name: "MacBook Pro", width: 3456, height: 2234 },
      ),
    ).toMatch(/Move it back/);
  });
});
