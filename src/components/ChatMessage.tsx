import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';
import { URLList } from './URLList';
import { RelatedPromptList } from './RelatedPromptList';
import { Bot, User, File, Brain } from "lucide-react";

import { AttachmentType, Message, Role, Model } from "../models/chat";
import { detectURLs } from "../lib/utils";

type ChatMessageProps = {
  message: Message;
  onURLClick?: (url: string) => void;
  onSendMessage?: (message: Message) => void;
  currentModel?: Model;
};

export function ChatMessage({ message, onURLClick, onSendMessage, currentModel }: ChatMessageProps) {
  const isUser = message.role === Role.User;
  const detectedURLs = detectURLs(message.content);

  if (!isUser && !message.content) {
    return (
      <div className="flex justify-start mb-4">
        <div className="mr-3 pt-3">
          <Bot className="w-6 h-6" />
        </div>
        <div className="flex items-center pt-5">
          <Brain className="w-5 h-5 animate-bounce text-neutral-600 dark:text-neutral-400" />
        </div>
      </div>
    );
  }

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
        className={`max-w-[80%] rounded-lg p-3 ${isUser ? "chat-bubble-user" : "chat-bubble-assistant group"} break-words overflow-x-auto`}
      >
        <Markdown>{message.content}</Markdown>

        {onURLClick && (
          <URLList urls={detectedURLs} onURLClick={onURLClick} />
        )}

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
          <div className="flex justify-between items-center mt-2">
            <div className="text-[9px] text-neutral-500 dark:text-neutral-400">
              Usage: {message.inputTokens} / {message.outputTokens} tokens
            </div>
            <div className="ml-2">
              <CopyButton text={message.content} subtle={true} />
            </div>
          </div>
        )}

        {!isUser && onSendMessage && currentModel && message.content && message.content.trim().length > 0 && (
          <RelatedPromptList
            prompt={message.content}
            model={currentModel.id}
            onPromptClick={onSendMessage}
          />
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
