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
};

export const ChatMessage = memo(function ChatMessage({ message, index, isResponding, isLast }: ChatMessageProps) {
  const isUser = message.role === Role.User;
  const isAssistant = message.role === Role.Assistant;

  // Summary marker: render as a small divider instead of an empty assistant bubble.
  if (isAssistant && message.content.length > 0 && message.content.every((p) => p.type === "summary")) {
    return (
      <div className="flex items-center gap-3 my-4 text-xs text-neutral-400 dark:text-neutral-500 select-none">
        <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
        <span>Earlier conversation summarized</span>
        <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
      </div>
    );
  }

  if (isUser) {
    // Tool result messages (user role, no text, has tool results)
    const hasToolResults = message.content.some((p) => p.type === "tool_result");
    const hasTextContent = message.content.some((p) => p.type === "text" && p.text);
    const hasMedia = message.content.some((p) => p.type === "image" || p.type === "file" || p.type === "audio");

    if (hasToolResults && !hasTextContent && !hasMedia) {
      return <ChatToolMessage message={message} index={index} />;
    }

    return <ChatUserMessage message={message} index={index} isResponding={isResponding} isLast={isLast} />;
  }

  if (isAssistant) {
    return <ChatAssistantMessage message={message} index={index} isLast={isLast} isResponding={isResponding} />;
  }

  return null;
});
