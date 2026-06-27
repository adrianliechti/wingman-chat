import { Pencil } from "lucide-react";
import { memo, useState } from "react";
import { ArtifactChip } from "@/features/artifacts/components/ArtifactChip";
import { useChat } from "@/features/chat/hooks/useChat";
import { cn } from "@/shared/lib/cn";
import type { AudioContent, Content, FileContent, ImageContent, Message, TextContent } from "@/shared/types/chat";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { CopyButton } from "@/shared/ui/CopyButton";
import { ChatInputAttachments } from "./ChatInputAttachments";
import { ChatMessageEditor } from "./ChatMessageEditor";
import { parseArtifactReference } from "./chatMessageUtils";

type ChatUserMessageProps = {
  message: Message;
  index: number;
  isResponding?: boolean;
  isLast?: boolean;
};

export const ChatUserMessage = memo(function ChatUserMessage({ message, index, isResponding }: ChatUserMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  // Drive the action-bar reveal with JS hover instead of CSS :hover — Safari
  // leaves :hover sticky (notably after a trackpad tap), so the buttons wouldn't
  // hide on mouse-leave.
  const [hovered, setHovered] = useState(false);
  // Get first text content only (user's typed message)
  const textContent = message.content.find((p) => p.type === "text")?.text ?? "";
  const [editContent, setEditContent] = useState(textContent);
  // Get additional text parts (file attachments) - all text content after the first one
  const textParts = message.content.filter((p): p is TextContent => p.type === "text");
  const additionalTextContent = textParts.slice(1);
  // Names of attachments already rendered inline (images/audio/files). Their
  // artifact reference is still sent so the model knows the workspace path, but
  // the chip would just duplicate the inline preview — so suppress it here.
  const inlineMediaNames = new Set(
    message.content
      .filter(
        (p): p is ImageContent | AudioContent | FileContent =>
          p.type === "image" || p.type === "audio" || p.type === "file",
      )
      .map((p) => p.name)
      .filter((n): n is string => !!n),
  );
  const basename = (path: string) => path.split("/").pop() ?? path;
  // Split off artifact-attachment references — rendered as clickable chips that
  // open the file in the artifacts editor — from any other plain text parts.
  const attachedArtifactPaths: string[] = [];
  const plainTextAttachments: TextContent[] = [];
  for (const part of additionalTextContent) {
    const paths = parseArtifactReference(part.text);
    if (paths.length) attachedArtifactPaths.push(...paths.filter((p) => !inlineMediaNames.has(basename(p))));
    else plainTextAttachments.push(part);
  }
  const [editAdditionalTextContent, setEditAdditionalTextContent] = useState<TextContent[]>(additionalTextContent);
  // Get media content (images, audio, files) for editing
  const mediaContent = message.content.filter(
    (p): p is ImageContent | AudioContent | FileContent =>
      p.type === "image" || p.type === "audio" || p.type === "file",
  );
  const [editMediaContent, setEditMediaContent] = useState<(ImageContent | AudioContent | FileContent)[]>(mediaContent);
  const { sendMessage, chat } = useChat();

  // Check for images and files in content
  const mediaParts = message.content.filter(
    (p) => p.type === "image" || p.type === "file" || p.type === "audio",
  ) as Content[];
  const hasMedia = mediaParts.length > 0;

  const handleEditContentChange = (value: string) => {
    setEditContent(value);
  };

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
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only toggles the action bar; the buttons stay focusable on their own
    <div
      className="flex justify-end pb-2 text-neutral-900 dark:text-neutral-200 min-w-0 overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={cn("flex flex-col items-end min-w-0", isEditing ? "flex-1" : "max-w-[85%]")}>
        {isEditing ? (
          <ChatMessageEditor
            editContent={editContent}
            onEditContentChange={handleEditContentChange}
            onKeyDown={handleKeyDown}
            editAdditionalTextContent={editAdditionalTextContent}
            onRemoveAdditionalText={handleRemoveAdditionalText}
            editMediaContent={editMediaContent}
            onRemoveMedia={handleRemoveMedia}
            onCancel={handleCancelEdit}
            onConfirm={handleConfirmEdit}
          />
        ) : (
          <>
            <div className="rounded-lg py-3 px-3 bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-200 overflow-hidden min-w-0 w-full">
              <pre className="whitespace-pre-wrap font-sans [overflow-wrap:anywhere] min-w-0">{textContent}</pre>
              {/* Artifact attachments — clickable chips that open the file in the editor */}
              {attachedArtifactPaths.length > 0 && (
                <div className="pt-2 flex flex-wrap gap-2">
                  {attachedArtifactPaths.map((path) => (
                    <ArtifactChip key={path} path={path} />
                  ))}
                </div>
              )}
              {/* Any remaining plain text attachments as attachment tiles */}
              {plainTextAttachments.length > 0 && (
                <div className="pt-2">
                  <ChatInputAttachments attachments={plainTextAttachments} extractingAttachments={new Set()} />
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
              className={cn(
                "flex items-center gap-2 justify-end mt-1 pr-1 transition-opacity duration-200",
                isResponding ? "invisible" : hovered ? "opacity-100" : "opacity-100 md:opacity-0",
              )}
            >
              <CopyButton markdown={textContent} className="h-4 w-4" />
              <button
                onClick={handleStartEdit}
                className="p-2 -m-1 text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100"
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
