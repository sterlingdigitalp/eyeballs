import { invoke } from "@tauri-apps/api/core";

export type RendererLogLevel = "info" | "warn" | "error";

export interface RendererLogOptions {
  correlationId?: string;
  level?: RendererLogLevel;
  fields?: Record<string, unknown>;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function logEvent(
  event: string,
  options: RendererLogOptions = {},
): Promise<void> {
  const level = options.level ?? "info";
  const payload = {
    event,
    correlationId: options.correlationId,
    level,
    fields: options.fields ?? {},
  };
  if (isTauri()) {
    try {
      await invoke("log_event", payload);
      return;
    } catch (cause) {
      console.error(JSON.stringify({
        event: "renderer_log_bridge_failed",
        sourceEvent: event,
        error: String(cause),
      }));
    }
  }
  const message = JSON.stringify({
    event,
    correlationId: options.correlationId,
    ...options.fields,
  });
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.info(message);
}
