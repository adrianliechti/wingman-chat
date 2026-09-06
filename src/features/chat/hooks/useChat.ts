import { useContext } from "react";
import {
  ChatContext,
  type ChatContextType,
  ChatListContext,
  ChatModelContext,
  ChatConversationContext,
  ChatRunStateContext,
  ChatActionsContext,
} from "@/features/chat/context/ChatContext";

export function useChat(): ChatContextType {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}

export function useChatList() {
  const context = useContext(ChatListContext);
  if (!context) throw new Error("useChatList must be used within a ChatProvider");
  return context;
}

export function useChatModel() {
  const context = useContext(ChatModelContext);
  if (!context) throw new Error("useChatModel must be used within a ChatProvider");
  return context;
}

export function useChatConversation() {
  const context = useContext(ChatConversationContext);
  if (!context) throw new Error("useChatConversation must be used within a ChatProvider");
  return context;
}

export function useChatRunState() {
  const context = useContext(ChatRunStateContext);
  if (!context) throw new Error("useChatRunState must be used within a ChatProvider");
  return context;
}

export function useChatActions() {
  const context = useContext(ChatActionsContext);
  if (!context) throw new Error("useChatActions must be used within a ChatProvider");
  return context;
}
