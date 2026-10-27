import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useProjects } from "@/features/projects/context/ProjectsContext";

export function useChatNavigate() {
  const navigate = useNavigate();
  const { editProject } = useProjects();

  const newChat = useCallback(() => {
    editProject(null);
    void navigate({ to: "/chat" });
  }, [navigate, editProject]);

  const openChat = useCallback(
    (chatId: string) => {
      editProject(null);
      void navigate({ to: "/chat/$chatId", params: { chatId } });
    },
    [navigate, editProject],
  );

  return { newChat, openChat };
}
