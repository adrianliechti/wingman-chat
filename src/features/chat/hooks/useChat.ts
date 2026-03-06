import { useContext } from "react";
import { ChatContext } from "@/features/chat/context/ChatContext";
import type { ChatContextType } from "@/features/chat/context/ChatContext";

export function useChat(): ChatContextType {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
