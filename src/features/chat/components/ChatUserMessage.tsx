import { Pencil } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import type {
  AudioContent,
  Content,
  FileContent,
  ImageContent,
  Message,
  TextContent,
} from "@/shared/types/chat";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { CopyButton } from "@/shared/ui/CopyButton";
import { ChatInputAttachments } from "./ChatInputAttachments";
import { ChatMessageEditor } from "./ChatMessageEditor";

type ChatUserMessageProps = {
  message: Message;
  index: number;
  isResponding?: boolean;
  isLast?: boolean;
};

export const ChatUserMessage = memo(function ChatUserMessage({
  message,
  index,
  isResponding,
}: ChatUserMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  // Get first text content only (user's typed message)
  const textContent = message.content.find((p) => p.type === "text")?.text ?? "";
  const [editContent, setEditContent] = useState(textContent);
  // Get additional text parts (file attachments) - all text content after the first one
  const textParts = message.content.filter((p): p is TextContent => p.type === "text");
  const additionalTextContent = textParts.slice(1);
  const [editAdditionalTextContent, setEditAdditionalTextContent] = useState<TextContent[]>(additionalTextContent);
  // Get media content (images, audio, files) for editing
  const mediaContent = message.content.filter(
    (p): p is ImageContent | AudioContent | FileContent =>
      p.type === "image" || p.type === "audio" || p.type === "file",
  );
  const [editMediaContent, setEditMediaContent] = useState<(ImageContent | AudioContent | FileContent)[]>(mediaContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, chat } = useChat();

  // Check for images and files in content
  const mediaParts = message.content.filter(
    (p) => p.type === "image" || p.type === "file" || p.type === "audio",
  ) as Content[];
  const hasMedia = mediaParts.length > 0;

  // Auto-resize textarea and focus when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing]);

  // Auto-resize textarea on content change
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editContent]);

  const handleStartEdit = () => {
    if (isResponding) return;
    setEditContent(textContent);
    setEditAdditionalTextContent(additionalTextContent);
    setEditMediaContent(mediaContent);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(textContent);
    setEditAdditionalTextContent(additionalTextContent);
    setEditMediaContent(mediaContent);
  };

  const handleRemoveAdditionalText = (indexToRemove: number) => {
    setEditAdditionalTextContent((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const handleRemoveMedia = (indexToRemove: number) => {
    setEditMediaContent((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const handleConfirmEdit = async () => {
    // Allow edit if there's text content OR attachments
    if ((editContent.trim() === "" && editAdditionalTextContent.length === 0 && editMediaContent.length === 0) || !chat)
      return;
    setIsEditing(false);

    // Truncate history and send edited message, preserving additional text content (file attachments) and media
    const truncatedHistory = chat.messages.slice(0, index);
    const newContent: Content[] = [];
    if (editContent.trim()) {
      newContent.push({ type: "text" as const, text: editContent });
    }
    newContent.push(...editAdditionalTextContent);
    newContent.push(...editMediaContent);
    const editedMessage = { ...message, content: newContent };
    await sendMessage(editedMessage, truncatedHistory);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleConfirmEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  return (
    <div className="flex justify-end pb-2 group text-neutral-900 dark:text-neutral-200">
      <div className={`flex flex-col items-end${isEditing ? " flex-1" : ""}`}>
        {isEditing ? (
          <ChatMessageEditor
            editContent={editContent}
            onEditContentChange={setEditContent}
            onKeyDown={handleKeyDown}
            textareaRef={textareaRef}
            editAdditionalTextContent={editAdditionalTextContent}
            onRemoveAdditionalText={handleRemoveAdditionalText}
            editMediaContent={editMediaContent}
            onRemoveMedia={handleRemoveMedia}
            onCancel={handleCancelEdit}
            onConfirm={handleConfirmEdit}
          />
        ) : (
          <>
            <div className="rounded-lg py-3 px-3 bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-200 wrap-break-words overflow-x-auto">
              <pre className="whitespace-pre-wrap font-sans">{textContent}</pre>
              {/* Show additional text content (file attachments) as attachment tiles */}
              {additionalTextContent.length > 0 && (
                <div className="pt-2">
                  <ChatInputAttachments attachments={additionalTextContent} extractingAttachments={new Set()} />
                </div>
              )}

              {/* Render images, audio, and files from content */}
              {hasMedia && (
                <div className="pt-2">
                  <RenderContents contents={mediaParts} />
                </div>
              )}
            </div>

            <div
              className={`flex items-center gap-2 justify-end mt-1 pr-1 transition-opacity duration-200 ${isResponding ? "invisible" : "opacity-0 group-hover:opacity-100"}`}
            >
              <CopyButton markdown={textContent} className="h-4 w-4" />
              <button
                onClick={handleStartEdit}
                className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors"
                title="Edit message"
                type="button"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
