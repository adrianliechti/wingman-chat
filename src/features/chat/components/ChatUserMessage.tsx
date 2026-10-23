import { Pencil, TextSelect } from "lucide-react";
import { memo, useState } from "react";
import type { TextPart, UIMessage } from "@tanstack/ai";
import { ArtifactChip } from "@/features/artifacts/components/ArtifactChip";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useChatActions, useChatConversation } from "@/features/chat/hooks/useChat";
import { cn } from "@/shared/lib/cn";
import {
  artifactRefPart,
  isMediaPart,
  mediaName,
  text,
  textMetadata,
  type ArtifactSelection,
  type MediaPart,
} from "@/shared/lib/messages";
import { RenderContents } from "@/shared/ui/ContentRenderer";
import { CopyButton } from "@/shared/ui/CopyButton";
import { ChatInputAttachments } from "./ChatInputAttachments";
import { ChatMessageEditor } from "./ChatMessageEditor";
import { formatArtifactReference, parseArtifactReference } from "./chatMessageUtils";

// Re-append attached artifact paths that aren't referenced by the editable parts.
function withArtifactReferences(parts: TextPart[], paths: string[]): TextPart[] {
  try {
    const existingPaths = parts.flatMap((p) => parseArtifactReference(p.content));
    const toAdd = paths.filter((p) => !existingPaths.includes(p));
    return toAdd.length ? [...parts, text(formatArtifactReference(toAdd))] : parts;
  } catch {
    return parts;
  }
}

/** Paths a message refers to as workspace files, by chip metadata or by reference line. */
function referencedPaths(message: UIMessage): string[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "text") return [];
    const ref = textMetadata(part).artifactRef;
    return ref ? [ref.path] : parseArtifactReference(part.content);
  });
}

type ChatUserMessageProps = {
  message: UIMessage;
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
  // Plain text parts: the typed message first, then any attached text.
  const plainTextParts = message.parts.filter(
    (part): part is TextPart =>
      part.type === "text" && !textMetadata(part).artifactRef && !textMetadata(part).artifactSelection,
  );
  const textContent = plainTextParts[0]?.content ?? "";
  const [editContent, setEditContent] = useState(textContent);
  // Passages highlighted in the artifact viewer, sent along with the instruction.
  const selectionParts = message.parts.filter(
    (part): part is TextPart => part.type === "text" && !!textMetadata(part).artifactSelection,
  );
  // Additional text parts (file attachments) - all plain text content after the first one
  const additionalTextContent = plainTextParts.slice(1);
  // Names of attachments already rendered inline (images/audio/files). Their
  // artifact reference is still sent so the model knows the workspace path, but
  // the chip would just duplicate the inline preview — so suppress it here.
  const mediaContent = message.parts.filter(isMediaPart);
  const inlineMediaNames = new Set(mediaContent.map(mediaName).filter((n): n is string => !!n));
  const basename = (path: string) => path.split("/").pop() ?? path;
  // Split off artifact-attachment references — rendered as clickable chips that
  // open the file in the artifacts editor — from any other plain text parts.
  const attachedArtifactPaths: string[] = message.parts.flatMap((part) => {
    const ref = part.type === "text" ? textMetadata(part).artifactRef : undefined;
    return ref ? [ref.path] : [];
  });
  const plainTextAttachments: TextPart[] = [];
  // For the editor: a reference that only points at inline media (images) would
  // render a second time as a file tile, so split those paths out into
  // `mediaRefPaths` (re-attached on submit, tied to the surviving media) and keep
  // just the genuine file/plain-text parts editable.
  const mediaRefPaths: string[] = [];
  const editableAdditionalText: TextPart[] = [];
  for (const part of additionalTextContent) {
    const paths = parseArtifactReference(part.content);
    if (!paths.length) {
      plainTextAttachments.push(part);
      editableAdditionalText.push(part);
      continue;
    }
    const nonInline = paths.filter((p) => !inlineMediaNames.has(basename(p)));
    attachedArtifactPaths.push(...nonInline);
    mediaRefPaths.push(...paths.filter((p) => inlineMediaNames.has(basename(p))));
    if (nonInline.length) editableAdditionalText.push(text(formatArtifactReference(nonInline)));
  }
  const [editAdditionalTextContent, setEditAdditionalTextContent] = useState<TextPart[]>(editableAdditionalText);
  const [editMediaContent, setEditMediaContent] = useState<MediaPart[]>(mediaContent);
  const { sendMessage } = useChatActions();
  const { chat } = useChatConversation();

  const hasMedia = mediaContent.length > 0;

  const handleEditContentChange = (value: string) => {
    setEditContent(value);
  };

  const handleStartEdit = () => {
    if (isResponding) return;
    setEditContent(textContent);
    // Preserve artifact reference paths so attachments aren't lost.
    setEditAdditionalTextContent(withArtifactReferences(editableAdditionalText, attachedArtifactPaths));
    setEditMediaContent(mediaContent);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(textContent);
    // Restore original text and artifact refs.
    setEditAdditionalTextContent(withArtifactReferences(editableAdditionalText, attachedArtifactPaths));
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

    // Truncate history and send the edited message, preserving additional text content (file attachments) and media
    const truncatedHistory = chat.messages.slice(0, index);
    const parts: UIMessage["parts"] = [];
    if (editContent.trim()) {
      parts.push(text(editContent));
    }
    // The highlighted passage stays attached to an edited instruction.
    parts.push(...selectionParts);
    parts.push(...editAdditionalTextContent);
    parts.push(...editMediaContent);
    // Re-attach the workspace reference for media that survived editing (it was
    // hidden from the editor to avoid showing the image twice) so the model still
    // learns each image's artifact path. Dropped media drops its reference.
    const survivingMediaNames = new Set(editMediaContent.map(mediaName).filter((n): n is string => !!n));
    const keptMediaRefs = mediaRefPaths.filter((p) => survivingMediaNames.has(basename(p)));
    for (const path of keptMediaRefs) parts.push(artifactRefPart({ path, displayName: basename(path) }));
    const editedMessage: UIMessage = { ...message, parts };

    // Compute removed artifact paths and delete only unreferenced ones.
    const newArtifactPaths = new Set<string>([
      ...editAdditionalTextContent.flatMap((p) => parseArtifactReference(p.content)),
      ...keptMediaRefs,
    ]);
    const removed = attachedArtifactPaths.filter((p) => !newArtifactPaths.has(p));
    const safeToDelete = removed.filter(
      (p) => !chat.messages.some((m, i) => i !== index && referencedPaths(m).includes(p)),
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
                <SelectionQuote key={i} selection={textMetadata(part).artifactSelection!} />
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
                  <RenderContents contents={mediaContent} />
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
function SelectionQuote({ selection }: { selection: ArtifactSelection }) {
  const [expanded, setExpanded] = useState(false);
  const { openFile, setShowArtifactsDrawer } = useArtifacts();
  const name = selection.path.split("/").pop() ?? selection.path;
  const location = selection.startLine
    ? selection.endLine && selection.endLine !== selection.startLine
      ? `lines ${selection.startLine}–${selection.endLine}`
      : `line ${selection.startLine}`
    : null;
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-neutral-300/60 bg-white/60 text-left dark:border-neutral-700/60 dark:bg-neutral-950/40">
      <button
        type="button"
        onClick={() => {
          openFile(selection.path);
          setShowArtifactsDrawer(true);
        }}
        title={`Open ${selection.path}`}
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
          {selection.text}
        </pre>
      </button>
    </div>
  );
}
