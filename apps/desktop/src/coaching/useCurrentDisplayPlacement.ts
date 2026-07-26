import { useEffect, useState } from "react";
import {
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import type { PromptDisplayPlacement } from "../../../../packages/contracts/src";
import { promptDisplayFromMonitor } from "../lib/display-placement";

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function readCurrentDisplayPlacement(): Promise<
  PromptDisplayPlacement | undefined
> {
  if (!isTauri()) return undefined;
  const monitor = await currentMonitor();
  return monitor ? promptDisplayFromMonitor(monitor) : undefined;
}

export function useCurrentDisplayPlacement(): PromptDisplayPlacement | undefined {
  const [placement, setPlacement] = useState<PromptDisplayPlacement>();

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlistenMoved: (() => void) | undefined;
    let unlistenScale: (() => void) | undefined;
    const refresh = async () => {
      try {
        const next = await readCurrentDisplayPlacement();
        if (!disposed) setPlacement(next);
      } catch {
        if (!disposed) setPlacement(undefined);
      }
    };
    void (async () => {
      try {
        await refresh();
        const appWindow = getCurrentWindow();
        unlistenMoved = await appWindow.onMoved(() => void refresh());
        unlistenScale = await appWindow.onScaleChanged(() => void refresh());
      } catch {
        if (!disposed) setPlacement(undefined);
      }
    })();
    return () => {
      disposed = true;
      unlistenMoved?.();
      unlistenScale?.();
    };
  }, []);

  return placement;
}
