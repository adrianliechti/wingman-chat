import { memo } from "react";
import type { Message } from "@/shared/types/chat";
import { Role } from "@/shared/types/chat";
import { ChatAssistantMessage } from "./ChatAssistantMessage";
import { ChatToolMessage } from "./ChatToolMessage";
import { ChatUserMessage } from "./ChatUserMessage";

type ChatMessageProps = {
  index: number;
  message: Message;
  isLast?: boolean;
  isResponding?: boolean;
  onGoToLatest?: () => void;
};

export const ChatMessage = memo(function ChatMessage({
  message,
  index,
  isResponding,
  isLast,
  onGoToLatest,
}: ChatMessageProps) {
  const isUser = message.role === Role.User;
  const isAssistant = message.role === Role.Assistant;

  if (isUser) {
    // Tool result messages (user role, no text, has tool results)
    const hasToolResults = message.content.some((p) => p.type === "tool_result");
    const hasTextContent = message.content.some((p) => p.type === "text" && p.text);
    const hasMedia = message.content.some((p) => p.type === "image" || p.type === "file" || p.type === "audio");

    if (hasToolResults && !hasTextContent && !hasMedia) {
      return <ChatToolMessage message={message} index={index} />;
    }

    return (
      <ChatUserMessage
        message={message}
        index={index}
        isResponding={isResponding}
        isLast={isLast}
        onGoToLatest={onGoToLatest}
      />
    );
  }

  if (isAssistant) {
    return <ChatAssistantMessage message={message} index={index} isLast={isLast} isResponding={isResponding} />;
  }

  return null;
});
