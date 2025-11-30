import { memo } from "react";
import { Image, File, FileText, Loader2, X } from "lucide-react";

import { AttachmentType } from "../types/chat";
import type { Attachment } from "../types/chat";

interface ChatInputAttachmentsProps {
  attachments: Attachment[];
  extractingAttachments: Set<string>;
  onRemove: (index: number) => void;
}

const getAttachmentIcon = (attachment: Attachment) => {
  switch (attachment.type) {
    case AttachmentType.Image:
      return <Image size={24} />;
    case AttachmentType.Text:
      return <FileText size={24} />;
    case AttachmentType.File:
      return <File size={24} />;
    default:
      return <File size={24} />;
  }
};

export const ChatInputAttachments = memo(({ 
  attachments, 
  extractingAttachments, 
  onRemove 
}: ChatInputAttachmentsProps) => {
  if (attachments.length === 0 && extractingAttachments.size === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-3 p-3">
      {/* Loading attachments */}
      {Array.from(extractingAttachments).map((fileId) => (
        <div
          key={fileId}
          className="relative size-14 bg-white/30 dark:bg-neutral-800/60 backdrop-blur-lg rounded-xl border-2 border-dashed border-white/50 dark:border-white/30 flex items-center justify-center shadow-sm"
          title="Processing file..."
        >
          <Loader2 size={18} className="animate-spin text-neutral-500 dark:text-neutral-400" />
        </div>
      ))}

      {/* Processed attachments */}
      {attachments.map((attachment, index) => (
        <div
          key={index}
          className="relative size-14 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-sm flex items-center justify-center group hover:shadow-md hover:border-white/60 dark:hover:border-white/40 transition-all"
          title={attachment.name}
        >
          {attachment.type === AttachmentType.Image ? (
            <img
              src={attachment.data}
              alt={attachment.name}
              className="size-full object-cover rounded-xl"
            />
          ) : (
            <div className="text-neutral-600 dark:text-neutral-300">
              {getAttachmentIcon(attachment)}
            </div>
          )}
          <button
            type="button"
            className="absolute top-0.5 right-0.5 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
            onClick={() => onRemove(index)}
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
});

ChatInputAttachments.displayName = 'ChatInputAttachments';
