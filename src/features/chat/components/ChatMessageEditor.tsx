import { Send, X } from "lucide-react";
import type { RefObject } from "react";
import type { AudioContent, FileContent, ImageContent, TextContent } from "@/shared/types/chat";
import { ChatInputAttachments } from "./ChatInputAttachments";

type ChatMessageEditorProps = {
  editContent: string;
  onEditContentChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  editAdditionalTextContent: TextContent[];
  onRemoveAdditionalText: (index: number) => void;
  editMediaContent: (ImageContent | AudioContent | FileContent)[];
  onRemoveMedia: (index: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ChatMessageEditor({
  editContent,
  onEditContentChange,
  onKeyDown,
  textareaRef,
  editAdditionalTextContent,
  onRemoveAdditionalText,
  editMediaContent,
  onRemoveMedia,
  onCancel,
  onConfirm,
}: ChatMessageEditorProps) {
  return (
    <>
      <div className="rounded-lg py-3 px-3 bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-200 wrap-break-words overflow-x-auto self-stretch">
        <div className="flex flex-col gap-2">
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full min-w-50 bg-transparent border-none outline-none resize-none font-sans text-neutral-900 dark:text-neutral-200"
            rows={1}
          />
          {/* Show additional text attachments (file attachments) with ability to remove */}
          {editAdditionalTextContent.length > 0 && (
            <ChatInputAttachments
              attachments={editAdditionalTextContent}
              extractingAttachments={new Set()}
              onRemove={onRemoveAdditionalText}
            />
          )}
          {/* Show media attachments with ability to remove */}
          {editMediaContent.length > 0 && (
            <ChatInputAttachments
              attachments={editMediaContent}
              extractingAttachments={new Set()}
              onRemove={onRemoveMedia}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 justify-between mt-1 pr-1 self-stretch">
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500 select-none">
          Esc to cancel · Enter to submit
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onCancel}
            className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
            title="Cancel"
            type="button"
          >
            <X size={16} />
          </button>
          <button
            onClick={onConfirm}
            className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
            title="Save & Submit"
            type="button"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
