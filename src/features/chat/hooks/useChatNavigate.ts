import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useProjects } from "@/features/projects/context/ProjectsContext";

declare module "@tanstack/react-router" {
  interface HistoryState {
    chatSearchNavigationId?: string;
    chatSearchQuery?: string;
  }
}

export function useChatNavigate() {
  const navigate = useNavigate();
  const { editProject } = useProjects();

  const newChat = useCallback(() => {
    editProject(null);
    void navigate({ to: "/chat" });
  }, [navigate, editProject]);

  const openChat = useCallback(
    (chatId: string, match?: { messageId: string; query: string }) => {
      editProject(null);
      if (match) {
        void navigate({
          to: "/chat/$chatId/$messageId",
          params: { chatId, messageId: match.messageId },
          // A repeated click must jump again even when the URL is unchanged.
          state: { chatSearchNavigationId: crypto.randomUUID(), chatSearchQuery: match.query },
          resetScroll: false,
        });
      } else {
        void navigate({ to: "/chat/$chatId", params: { chatId } });
      }
    },
    [navigate, editProject],
  );

  return { newChat, openChat };
}
