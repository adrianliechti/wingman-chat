import { Pencil, TextSelect } from "lucide-react";
import { memo, useState } from "react";
import { ArtifactChip } from "@/features/artifacts/components/ArtifactChip";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useChatActions, useChatConversation } from "@/features/chat/hooks/useChat";
import { cn } from "@/shared/lib/cn";
import type {
  ArtifactSelectionContent,
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
import { formatArtifactReference, parseArtifactReference } from "./chatMessageUtils";

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
  // Passages highlighted in the artifact viewer, sent along with the instruction.
  const selectionParts = message.content.filter(
    (p): p is ArtifactSelectionContent => p.type === "artifact_selection",
  );
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
  attachedArtifactPaths.push(
    ...message.content.filter((part) => part.type === "artifact_ref").map((part) => part.path),
  );
  const plainTextAttachments: TextContent[] = [];
  // For the editor: a reference that only points at inline media (images) would
  // render a second time as a file tile, so split those paths out into
  // `mediaRefPaths` (re-attached on submit, tied to the surviving media) and keep
  // just the genuine file/plain-text parts editable.
  const mediaRefPaths: string[] = [];
  const editableAdditionalText: TextContent[] = [];
  for (const part of additionalTextContent) {
    const paths = parseArtifactReference(part.text);
    if (!paths.length) {
      plainTextAttachments.push(part);
      editableAdditionalText.push(part);
      continue;
    }
    const nonInline = paths.filter((p) => !inlineMediaNames.has(basename(p)));
    attachedArtifactPaths.push(...nonInline);
    mediaRefPaths.push(...paths.filter((p) => inlineMediaNames.has(basename(p))));
    if (nonInline.length) editableAdditionalText.push({ type: "text", text: formatArtifactReference(nonInline) });
  }
  const [editAdditionalTextContent, setEditAdditionalTextContent] = useState<TextContent[]>(editableAdditionalText);
  // Get media content (images, audio, files) for editing
  const mediaContent = message.content.filter(
    (p): p is ImageContent | AudioContent | FileContent =>
      p.type === "image" || p.type === "audio" || p.type === "file",
  );
  const [editMediaContent, setEditMediaContent] = useState<(ImageContent | AudioContent | FileContent)[]>(mediaContent);
  const { sendMessage } = useChatActions();
  const { chat } = useChatConversation();

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
    // Preserve `artifact_ref` paths so attachments aren't lost.
    try {
      const existingPaths = editableAdditionalText.flatMap((p) => parseArtifactReference(p.text));
      const toAdd = attachedArtifactPaths.filter((p) => !existingPaths.includes(p));
      setEditAdditionalTextContent(
        toAdd.length
          ? [...editableAdditionalText, { type: "text", text: formatArtifactReference(toAdd) }]
          : editableAdditionalText,
      );
    } catch {
      setEditAdditionalTextContent(editableAdditionalText);
    }
    setEditMediaContent(mediaContent);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(textContent);
    // Restore original text and artifact refs.
    try {
      const existingPaths = editableAdditionalText.flatMap((p) => parseArtifactReference(p.text));
      const toAdd = attachedArtifactPaths.filter((p) => !existingPaths.includes(p));
      setEditAdditionalTextContent(
        toAdd.length
          ? [...editableAdditionalText, { type: "text", text: formatArtifactReference(toAdd) }]
          : editableAdditionalText,
      );
    } catch {
      setEditAdditionalTextContent(editableAdditionalText);
    }
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
    // The highlighted passage stays attached to an edited instruction.
    newContent.push(...selectionParts);
    newContent.push(...editAdditionalTextContent);
    newContent.push(...editMediaContent);
    // Re-attach the workspace reference for media that survived editing (it was
    // hidden from the editor to avoid showing the image twice) so the model still
    // learns each image's artifact path. Dropped media drops its reference.
    const survivingMediaNames = new Set(editMediaContent.map((m) => m.name).filter((n): n is string => !!n));
    const keptMediaRefs = mediaRefPaths.filter((p) => survivingMediaNames.has(basename(p)));
    if (keptMediaRefs.length) {
      newContent.push({ type: "text", text: formatArtifactReference(keptMediaRefs) });
    }
    const editedMessage = { ...message, content: newContent };

    // Compute removed artifact paths and delete only unreferenced ones.
    const newArtifactPaths = new Set<string>([
      ...editAdditionalTextContent.flatMap((p) => parseArtifactReference(p.text)),
      ...keptMediaRefs,
    ]);
    const removed = attachedArtifactPaths.filter((p) => !newArtifactPaths.has(p));
    const safeToDelete = removed.filter(
      (p) =>
        !chat.messages.some(
          (m, i) =>
            i !== index &&
            m.content.some((part) =>
              part.type === "artifact_ref"
                ? part.path === p
                : part.type === "text"
                  ? parseArtifactReference(part.text).includes(p)
                  : false,
            ),
        ),
    );

    await sendMessage(editedMessage, truncatedHistory, undefined, safeToDelete.length ? safeToDelete : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleConfirmEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  return (
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
              {selectionParts.map((part, i) => (
                <SelectionQuote key={i} part={part} />
              ))}
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

/** The highlighted artifact passage an instruction refers to; opens the file on click. */
function SelectionQuote({ part }: { part: ArtifactSelectionContent }) {
  const [expanded, setExpanded] = useState(false);
  const { openFile, setShowArtifactsDrawer } = useArtifacts();
  const name = part.path.split("/").pop() ?? part.path;
  const location = part.startLine
    ? part.endLine && part.endLine !== part.startLine
      ? `lines ${part.startLine}–${part.endLine}`
      : `line ${part.startLine}`
    : null;
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-neutral-300/60 bg-white/60 text-left dark:border-neutral-700/60 dark:bg-neutral-950/40">
      <button
        type="button"
        onClick={() => {
          openFile(part.path);
          setShowArtifactsDrawer(true);
        }}
        title={`Open ${part.path}`}
        className="flex w-full items-center gap-1.5 border-b border-neutral-200/60 px-2 py-1 text-[11px] text-neutral-500 transition-colors hover:bg-black/5 dark:border-neutral-800/60 dark:text-neutral-400 dark:hover:bg-white/5"
      >
        <TextSelect size={11} className="shrink-0" />
        <span className="truncate">
          Selected in <span className="font-medium text-neutral-700 dark:text-neutral-300">{name}</span>
          {location ? ` · ${location}` : ""}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="block w-full text-left"
        title={expanded ? "Collapse" : "Expand"}
      >
        <pre
          className={cn(
            "px-2 py-1.5 font-sans text-xs whitespace-pre-wrap [overflow-wrap:anywhere] text-neutral-700 dark:text-neutral-300",
            !expanded && "line-clamp-4",
          )}
        >
          {part.text}
        </pre>
      </button>
    </div>
  );
}
