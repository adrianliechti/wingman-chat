import { useMemo } from "react";
import type { Message, ToolResultContent } from "@/shared/types/chat";

export function useLastFullscreenApp(
  messages: Message[],
  index: number,
  toolResultParts: ToolResultContent[],
): boolean {
  return useMemo(() => {
    if (!toolResultParts.length) return false;
    const tr = toolResultParts[0];
    if (typeof tr?.meta?.toolProvider !== "string" || typeof tr?.meta?.toolResource !== "string") return false;

    // Find the last message index with a fullscreen-capable tool result
    let lastFullscreenIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      for (const part of msg.content) {
        if (part.type !== "tool_result") continue;
        const p = part as ToolResultContent;
        if (typeof p.meta?.toolProvider !== "string" || typeof p.meta?.toolResource !== "string") continue;
        const modes = p.meta?.appDisplayModes as string[] | undefined;
        const defaultMode = p.meta?.defaultDisplayMode as string | undefined;
        // Check if fullscreen is supported: explicit modes, defaultDisplayMode hint, or absent (backward compat = both)
        const supportsFullscreen = modes ? modes.includes("fullscreen") : defaultMode !== "inline"; // "fullscreen" or absent both mean fullscreen is supported
        if (supportsFullscreen) {
          lastFullscreenIndex = i;
          break;
        }
      }
      if (lastFullscreenIndex >= 0) break;
    }

    return lastFullscreenIndex === index;
  }, [messages, index, toolResultParts]);
}
