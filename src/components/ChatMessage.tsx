import { Markdown } from './Markdown';
import { Bot, User, File } from "lucide-react";

import { AttachmentType, Message, Role } from "../models/chat";

type ChatMessageProps = {
  message: Message;
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === Role.User;

  return (
    <div
      className={`flex chat-bubble ${isUser ? "justify-end" : "justify-start"} mb-4`}
    >
      {!isUser && (
        <div className="mr-3 pt-3">
          <Bot className="w-6 h-6" />
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-lg p-3 ${isUser ? "chat-bubble-user" : "chat-bubble-assistant"} break-words overflow-x-auto`}
      >
        <Markdown>{message.content}</Markdown>

        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <div className="grid grid-cols-2 gap-2">
              {message.attachments
                .filter(
                  (attachment) => attachment.type !== AttachmentType.Image
                )
                .map((attachment, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <File className="w-4 h-4 shrink-0" />
                    <span className="truncate">{attachment.name}</span>
                  </div>
                ))}
            </div>

            <div className="flex flex-wrap gap-4">
              {message.attachments
                .filter(
                  (attachment) => attachment.type === AttachmentType.Image
                )
                .map((attachment, index) => (
                  <img
                    key={index}
                    src={attachment.data}
                    className="max-h-60 rounded-md"
                    alt={attachment.name}
                  />
                ))}
            </div>
          </div>
        )}
        
        {!isUser && (message.inputTokens !== undefined && message.outputTokens !== undefined) && (
          <div className="text-[9px] text-neutral-500 dark:text-neutral-400 mt-2">
            Usage: {message.inputTokens} / {message.outputTokens} tokens
          </div>
        )}
      </div>

      {isUser && (
        <div className="ml-3 pt-3">
          <User className="w-6 h-6" />
        </div>
      )}
    </div>
  );
}
