import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

import { Bot, User, File } from "lucide-react";

import { AttachmentType, Message, Role } from "../models/chat";

type ChatMessageProps = {
  message: Message;
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === Role.User;

  const bubbleClasses = isUser
    ? "bg-[#3a3a3c] text-[#e5e5e5]"
    : "bg-[#2c2c2e] text-[#e5e5e5]";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
    >
      {!isUser && (
        <div className="mr-3 pt-3">
          <Bot className="text-[#e5e5e5] w-6 h-6" />
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-lg p-3 ${bubbleClasses} whitespace-pre-wrap leading-normal break-words overflow-x-auto`}
      >
        <ReactMarkdown
          children={message.content}
          components={{
            p: ({ node, ...props }) => <p {...props} />,
            ul: ({ node, ...props }) => (
              <ul className="list-disc list-inside" {...props} />
            ),
            ol: ({ node, ...props }) => (
              <ol className="list-decimal list-inside" {...props} />
            ),
            code(props) {
              const { children, className, node, ref, ...rest } = props;
              const match = /language-(\w+)/.exec(className || "");
              return match ? (
                <SyntaxHighlighter
                  {...rest}
                  className={`${className}`}
                  children={String(children).replace(/\n$/, "")}
                  PreTag="div"
                  style={vscDarkPlus}
                  language={match[1]}
                />
              ) : (
                <code
                  {...rest}
                  className={`${className}`}
                  children={children}
                />
              );
            },
          }}
        />

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
      </div>

      {isUser && (
        <div className="ml-3 pt-3">
          <User className="text-[#e5e5e5] w-6 h-6" />
        </div>
      )}
    </div>
  );
}
