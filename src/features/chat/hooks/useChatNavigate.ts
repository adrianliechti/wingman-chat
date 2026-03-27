import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChat } from "@/features/chat/hooks/useChat";

export function useChatNavigate() {
  const navigate = useNavigate();
  const { selectChat } = useChat();

  const newChat = useCallback(() => {
    selectChat(null);
    navigate({ to: "/chat" });
  }, [navigate, selectChat]);

  const openChat = useCallback(
    (chatId: string) => {
      selectChat(chatId);
      navigate({ to: "/chat/$chatId", params: { chatId } });
    },
    [navigate, selectChat],
  );

  return { newChat, openChat };
}
