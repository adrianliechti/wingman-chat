import { useMemo, type ReactNode } from "react";
import {
  ChatContext,
  type ChatContextType,
  ChatListContext,
  ChatModelContext,
  ChatConversationContext,
  ChatRunStateContext,
  ChatActionsContext,
} from "./ChatContext";

/** Values follow UI subscription boundaries; message drafts stay out of list/actions. */
export function ChatContextProviders({ value, children }: { value: ChatContextType; children: ReactNode }) {
  const chatList = useMemo(
    () => ({
      chats: value.chats,
      chatsLoaded: value.chatsLoaded,
      chatId: value.chatId,
      chatLoading: value.chatLoading,
      chatError: value.chatError,
      hasMessages: value.hasMessages,
    }),
    [value.chats, value.chatsLoaded, value.chatId, value.chatLoading, value.chatError, value.hasMessages],
  );
  const chatModel = useMemo(
    () => ({
      models: value.models,
      model: value.model,
      effort: value.effort,
      verbosity: value.verbosity,
      setModel: value.setModel,
      setEffort: value.setEffort,
      setVerbosity: value.setVerbosity,
    }),
    [value.models, value.model, value.effort, value.verbosity, value.setModel, value.setEffort, value.setVerbosity],
  );
  const chatConversation = useMemo(
    () => ({
      chat: value.chat,
      messages: value.messages,
      toolMeta: value.toolMeta,
    }),
    [value.chat, value.messages, value.toolMeta],
  );
  const chatRunState = useMemo(
    () => ({
      isResponding: value.isResponding,
      status: value.status,
      queuedSends: value.queuedSends,
      pendingElicitation: value.pendingElicitation,
      pendingConsent: value.pendingConsent,
    }),
    [value.isResponding, value.status, value.queuedSends, value.pendingElicitation, value.pendingConsent],
  );
  const chatActions = useMemo(
    () => ({
      stopStreaming: value.stopStreaming,
      createChat: value.createChat,
      selectChat: value.selectChat,
      deleteChat: value.deleteChat,
      updateChat: value.updateChat,
      loadChat: value.loadChat,
      searchChats: value.searchChats,
      ensureChat: value.ensureChat,
      addMessage: value.addMessage,
      sendMessage: value.sendMessage,
      retryMessage: value.retryMessage,
      continueRun: value.continueRun,
      removeQueuedMessage: value.removeQueuedMessage,
      sendHeldMessage: value.sendHeldMessage,
      setVoiceToolCall: value.setVoiceToolCall,
      resolveElicitation: value.resolveElicitation,
      requestElicitation: value.requestElicitation,
      updateToolMeta: value.updateToolMeta,
      resolveConsent: value.resolveConsent,
    }),
    [
      value.stopStreaming,
      value.createChat,
      value.selectChat,
      value.deleteChat,
      value.updateChat,
      value.loadChat,
      value.searchChats,
      value.ensureChat,
      value.addMessage,
      value.sendMessage,
      value.retryMessage,
      value.continueRun,
      value.removeQueuedMessage,
      value.sendHeldMessage,
      value.setVoiceToolCall,
      value.resolveElicitation,
      value.requestElicitation,
      value.updateToolMeta,
      value.resolveConsent,
    ],
  );
  return (
    <ChatContext value={value}>
      <ChatListContext value={chatList}>
        <ChatModelContext value={chatModel}>
          <ChatConversationContext value={chatConversation}>
            <ChatRunStateContext value={chatRunState}>
              <ChatActionsContext value={chatActions}>{children}</ChatActionsContext>
            </ChatRunStateContext>
          </ChatConversationContext>
        </ChatModelContext>
      </ChatListContext>
    </ChatContext>
  );
}
