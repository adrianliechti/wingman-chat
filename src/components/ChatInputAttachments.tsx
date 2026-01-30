import { memo } from "react";
import { Image, File, FileText, Loader2, X } from "lucide-react";

import type { Content } from "../types/chat";

interface ChatInputAttachmentsProps {
  attachments: Content[];
  extractingAttachments: Set<string>;
  onRemove?: (index: number) => void;
}

const getContentIcon = (content: Content) => {
  switch (content.type) {
    case 'image':
      return <Image size={24} />;
    case 'text':
      return <FileText size={24} />;
    case 'file':
      return <File size={24} />;
    case 'audio':
      return <File size={24} />;
    default:
      return <File size={24} />;
  }
};

// Helper to get display name from content
const getContentName = (content: Content): string => {
  if (content.type === 'file') return content.name;
  if (content.type === 'image' && content.name) return content.name;
  if (content.type === 'audio' && content.name) return content.name;
  if (content.type === 'text') return 'Text content';
  return content.type;
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
    <div className="flex flex-wrap gap-3">
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
      {attachments.map((content, index) => (
        <div
          key={index}
          className="relative size-14 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-sm flex items-center justify-center group hover:shadow-md hover:border-white/60 dark:hover:border-white/40 transition-all"
          title={getContentName(content)}
        >
          {content.type === 'image' ? (
            <img
              src={content.data}
              alt={content.name || 'image'}
              className="size-full object-cover rounded-xl"
            />
          ) : (
            <div className="text-neutral-600 dark:text-neutral-300">
              {getContentIcon(content)}
            </div>
          )}
          {onRemove && (
            <button
              type="button"
              className="absolute top-0.5 right-0.5 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
              onClick={() => onRemove(index)}
            >
              <X size={10} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
});

ChatInputAttachments.displayName = 'ChatInputAttachments';
