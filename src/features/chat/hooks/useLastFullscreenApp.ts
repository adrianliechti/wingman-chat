import type { UIResourcePart, UIMessage } from "@tanstack/ai";
import { useMemo } from "react";

/** Whether `app` (in the message at `index`) is the latest app that may take the panel. */
export function useLastFullscreenApp(messages: UIMessage[], index: number, app?: UIResourcePart): boolean {
  return useMemo(() => {
    if (!app?.serverId) return false;

    // Before initialization, the saved initial-mode hint is all we know.
    // Each live app checks its own handshake before taking the panel.
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const part of messages[i].parts.toReversed()) {
        if (part.type !== "ui-resource" || !part.serverId || !part.resource.uri.startsWith("ui://")) continue;
        if (part.meta?.appDisplayMode !== "inline") {
          return i === index && part.toolCallId === app.toolCallId && part.serverId === app.serverId;
        }
      }
    }
    return false;
  }, [messages, index, app]);
}
