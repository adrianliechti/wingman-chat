import { useContext } from "react";
import { ChatContext } from "../contexts/ChatContext";
import type { ChatContextType } from "../contexts/ChatContext";

export function useChat(): ChatContextType {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
