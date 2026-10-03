import { memo } from "react";
import type { UIMessage } from "@tanstack/ai";
import { messageMetadata } from "@/shared/lib/messages";
import { ChatAssistantMessage } from "./ChatAssistantMessage";
import { ChatToolMessage } from "./ChatToolMessage";
import { ChatUserMessage } from "./ChatUserMessage";
import { ChatMessageAttachments } from "./ChatMessageAttachments";
import { hasStoredAttachments } from "../lib/chatAttachments";
import { isToolOnlyMessage, subagentToolCallIds, toolRounds } from "./chatMessageUtils";
import { useChatConversation } from "../hooks/useChat";

type ChatMessageProps = {
  index: number;
  message: UIMessage;
  isLast?: boolean;
  isResponding?: boolean;
};

export const ChatMessage = memo(function ChatMessage(props: ChatMessageProps) {
  return hasStoredAttachments(props.message) ? (
    <ChatMessageAttachments message={props.message}>
      {(message) => <ChatMessageBody {...props} message={message} />}
    </ChatMessageAttachments>
  ) : (
    <ChatMessageBody {...props} />
  );
});

/** A committed tool-only turn: one row per round, outside any group. */
function ToolRows({ message, index }: { message: UIMessage; index: number }) {
  const { messages } = useChatConversation();
  const delegated = subagentToolCallIds(messages);
  return (
    <>
      {toolRounds(message, delegated).map(({ call, result }) => (
        <ChatToolMessage key={call.id} message={message} call={call} result={result} index={index} />
      ))}
    </>
  );
}

function ChatMessageBody({ message, index, isResponding, isLast }: ChatMessageProps) {
  const { kind } = messageMetadata(message);
  if (kind === "runtime_feedback" || message.role === "system") return null;

  // Summary marker: render as a small divider instead of an empty assistant bubble.
  if (kind === "summary") {
    return (
      <div className="flex items-center gap-3 my-4 text-xs text-neutral-400 dark:text-neutral-500 select-none">
        <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
        <span>Earlier conversation summarized</span>
        <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
      </div>
    );
  }

  if (message.role === "user") {
    return <ChatUserMessage message={message} index={index} isResponding={isResponding} isLast={isLast} />;
  }

  // Tool rounds still running render through the assistant's live view.
  const settled = isToolOnlyMessage(message) && !(isLast && isResponding);
  if (settled) return <ToolRows message={message} index={index} />;

  return <ChatAssistantMessage message={message} index={index} isLast={isLast} isResponding={isResponding} />;
}
