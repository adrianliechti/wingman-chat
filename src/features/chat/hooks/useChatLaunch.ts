import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { decodeConversationLink, decodeConversationLinkJson } from "@/features/chat/lib/conversationLink";
import { parseLaunchParams } from "@/features/chat/lib/launchParams";

/** sessionStorage key used to hand the prefill over a navigation boundary (import + q case). */
const PENDING_PREFILL_KEY = "wing:launch:prefill";

export interface ChatLaunchState {
  initialContent: string;
  autoSubmit: boolean;
}

/**
 * Reads deep-link launch params from the current URL once per component
 * mount (gated on `chatsLoaded`) and either:
 *
 * - **Prefill mode** (`q=...`): returns `{ initialContent, autoSubmit }` for
 *   `ChatInput` to consume, then clears the URL.
 *
 * - **Import mode** (`import=...` / `import_json=...`): decodes the
 *   conversation payload, creates a new chat with the imported messages,
 *   clears the URL, and lets ChatPage's state→URL effect navigate to
 *   `/chat/$chatId`. If a `q` param is also present it is stored in
 *   `sessionStorage` so it survives the navigation and is returned as
 *   `initialContent` on the next mount.
 */
export function useChatLaunch(): ChatLaunchState {
  const { chatsLoaded, importChat } = useChat();
  const location = useLocation();
  const consumedRef = useRef(false);

  const [state, setState] = useState<ChatLaunchState>({ initialContent: "", autoSubmit: false });

  // Consume any prefill that was stored before a navigation (import + q case).
  // Uses location.pathname as a dependency so it fires on both initial mount AND
  // after TanStack Router navigates to the new chat route — regardless of whether
  // ChatPage remounts (the router reuses the component instance when both /chat
  // and /chat/$chatId render the same component type).
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_PREFILL_KEY);
    if (!pending) return;
    sessionStorage.removeItem(PENDING_PREFILL_KEY);
    try {
      setState(JSON.parse(pending) as ChatLaunchState);
    } catch {
      // ignore malformed entry
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!chatsLoaded) return;
    if (consumedRef.current) return;
    consumedRef.current = true;

    const params = parseLaunchParams(window.location.search, window.location.hash);
    const hasImport = !!(params.importCompressed ?? params.importJson);
    const hasPrefill = !!params.q;

    if (!hasImport && !hasPrefill) return;

    if (hasImport) {
      (async () => {
        try {
          const payload = params.importCompressed
            ? await decodeConversationLink(params.importCompressed)
            : decodeConversationLinkJson(params.importJson ?? "");

          // If a follow-up prompt was also provided, carry it over the
          // navigation boundary via sessionStorage.
          if (hasPrefill) {
            sessionStorage.setItem(
              PENDING_PREFILL_KEY,
              JSON.stringify({ initialContent: params.q ?? "", autoSubmit: params.send } satisfies ChatLaunchState),
            );
          }

          await importChat(payload.messages);
        } catch (err) {
          console.error("[useChatLaunch] Failed to import conversation link:", err);
        } finally {
          // Clear the hash/search from the URL without routing to a new path.
          // ChatPage's state→URL useEffect will navigate to /chat/$chatId once
          // it sees the chatId state change — this avoids a race where TanStack
          // Router renders ChatPage before React has committed the updated chats
          // array, causing the URL→state guard to redirect back to /chat.
          window.history.replaceState(null, "", window.location.pathname);
        }
      })();
    } else {
      // Prefill only — set state and clear URL without causing a remount
      setState({ initialContent: params.q ?? "", autoSubmit: params.send });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [chatsLoaded, importChat]);

  return state;
}
