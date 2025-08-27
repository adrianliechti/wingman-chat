import { File, Download } from "lucide-react";
import { AttachmentType } from "../types/chat";
import type { Attachment } from "../types/chat";
import { downloadFromUrl } from "../lib/utils";
import { detectMimeType } from "../lib/attachmentUtils";

// Helper function to categorize attachments for layout purposes
function categorizeAttachments(attachments: Attachment[]) {
  const media: Attachment[] = [];
  const files: Attachment[] = [];
  const pdfs: Attachment[] = [];
  
  attachments.forEach(attachment => {
    const mimeType = detectMimeType(attachment.data, attachment.name);
    
    if (mimeType === 'application/pdf') {
      pdfs.push(attachment);
    } else if (attachment.type === AttachmentType.Image || 
        mimeType.startsWith('image/') || 
        mimeType.startsWith('video/') || 
        mimeType.startsWith('audio/')) {
      media.push(attachment);
    } else {
      files.push(attachment);
    }
  });
  
  return { media, files, pdfs };
}

// Component for image attachments with download functionality
function ImageAttachment({ attachment, className }: { attachment: Attachment; className?: string }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    downloadFromUrl(attachment.data, attachment.name);
  };

  return (
    <div className="relative group inline-block">
      <img
        src={attachment.data}
        alt={attachment.name}
        className={className}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <button
          onClick={handleDownload}
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 p-2 rounded-full shadow-lg cursor-pointer"
          title="Download image"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Component for video attachments
function VideoAttachment({ attachment, className }: { attachment: Attachment; className?: string }) {
  return (
    <div className="relative group inline-block">
      <video
        src={attachment.data}
        controls
        className={className}
        title={attachment.name}
      />
    </div>
  );
}

// Component for audio attachments
function AudioAttachment({ attachment, className }: { attachment: Attachment; className?: string }) {
  return (
    <div className="flex items-center gap-2 p-2 border border-neutral-200 dark:border-neutral-700 rounded-md">
      <audio
        src={attachment.data}
        controls
        className={className}
        title={attachment.name}
      />
    </div>
  );
}

// Component for file attachments (non-media)
function FileAttachment({ attachment }: { attachment: Attachment }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    downloadFromUrl(attachment.data, attachment.name);
  };

  return (
    <div 
      className="flex items-center gap-2 text-sm p-2 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors"
      onClick={handleDownload}
      title={`Download ${attachment.name}`}
    >
      <File className="w-4 h-4 shrink-0" />
      <span className="truncate">{attachment.name}</span>
      <Download className="w-4 h-4 shrink-0 ml-auto opacity-60" />
    </div>
  );
}

// Component for PDF attachments with preview
function PdfAttachment({ attachment }: { attachment: Attachment }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    downloadFromUrl(attachment.data, attachment.name);
  };

  // Convert base64 to data URL for iframe
  const pdfDataUrl = attachment.data.startsWith('data:') 
    ? attachment.data 
    : `data:application/pdf;base64,${attachment.data}`;

  return (
    <div className="w-full border border-neutral-200 dark:border-neutral-700 rounded-md overflow-hidden">
      {/* PDF Header with download button */}
      <div className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center gap-2">
          <File className="w-5 h-5 text-red-500" />
          <span className="font-medium text-sm truncate">{attachment.name}</span>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1 px-3 py-1 text-xs bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 rounded transition-colors"
          title="Download PDF"
        >
          <Download className="w-3 h-3" />
          Download
        </button>
      </div>
      
      {/* PDF Preview */}
      <div className="w-full h-96">
        <iframe
          src={pdfDataUrl}
          className="w-full h-full"
          title={`Preview of ${attachment.name}`}
          style={{ border: 'none' }}
        />
      </div>
    </div>
  );
}

// Main attachment renderer that decides which component to use
export function AttachmentRenderer({ attachment, className }: { attachment: Attachment; className?: string }) {
  const mimeType = detectMimeType(attachment.data, attachment.name);
  
  // Check for PDF first
  if (mimeType === 'application/pdf') {
    return <PdfAttachment attachment={attachment} />;
  }
  
  // Use attachment type first, then fall back to MIME type detection
  if (attachment.type === AttachmentType.Image || mimeType.startsWith('image/')) {
    return <ImageAttachment attachment={attachment} className={className} />;
  }
  
  if (mimeType.startsWith('video/')) {
    return <VideoAttachment attachment={attachment} className={className} />;
  }
  
  if (mimeType.startsWith('audio/')) {
    return <AudioAttachment attachment={attachment} className={className} />;
  }
  
  // Default to file attachment for everything else
  return <FileAttachment attachment={attachment} />;
}

// Main component for rendering a list of attachments
export function AttachmentList({ attachments, mediaClassName }: { 
  attachments: Attachment[]; 
  mediaClassName?: string;
}) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const { media, files, pdfs } = categorizeAttachments(attachments);
  
  return (
    <div className="flex flex-col gap-2">
      {/* PDF attachments - full width */}
      {pdfs.length > 0 && (
        <div className="space-y-3">
          {pdfs.map((attachment, index) => (
            <AttachmentRenderer key={`pdf-${index}`} attachment={attachment} />
          ))}
        </div>
      )}

      {/* File attachments in grid layout */}
      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {files.map((attachment, index) => (
            <AttachmentRenderer key={`file-${index}`} attachment={attachment} />
          ))}
        </div>
      )}

      {/* Media attachments in flex layout */}
      {media.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {media.map((attachment, index) => (
            <AttachmentRenderer 
              key={`media-${index}`} 
              attachment={attachment} 
              className={mediaClassName || "max-h-40 rounded-md"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
