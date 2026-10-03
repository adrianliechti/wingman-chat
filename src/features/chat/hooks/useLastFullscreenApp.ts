import type { ToolResultPart, UIMessage } from "@tanstack/ai";
import { useMemo } from "react";
import { toolResultMetadata } from "@/shared/lib/messages";

function appMeta(part: ToolResultPart) {
  const meta = toolResultMetadata(part).meta;
  if (typeof meta?.toolProvider !== "string" || typeof meta?.toolResource !== "string") return null;
  return meta;
}

/** Whether `result` (in the message at `index`) is the latest app that may take the panel. */
export function useLastFullscreenApp(messages: UIMessage[], index: number, result?: ToolResultPart): boolean {
  return useMemo(() => {
    if (!result || !appMeta(result)) return false;

    // Find the last message index with a fullscreen-capable tool result
    let lastFullscreenIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts) {
        if (part.type !== "tool-result") continue;
        const meta = appMeta(part);
        if (!meta) continue;
        const modes = meta.appDisplayModes as string[] | undefined;
        const defaultMode = meta.defaultDisplayMode as string | undefined;
        // Check if fullscreen is supported: explicit modes, defaultDisplayMode hint, or absent (backward compat = both)
        const supportsFullscreen = modes ? modes.includes("fullscreen") : defaultMode !== "inline";
        if (supportsFullscreen) {
          lastFullscreenIndex = i;
          break;
        }
      }
      if (lastFullscreenIndex >= 0) break;
    }

    return lastFullscreenIndex === index;
  }, [messages, index, result]);
}
