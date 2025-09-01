import { File, Download } from "lucide-react";
import type { Attachment } from "../types/chat";
import { AttachmentType } from "../types/chat";
import { downloadBlob, downloadFromUrl } from "../lib/utils";
import { detectMimeType } from "../lib/attachmentUtils";
import { PdfRenderer } from "./PdfRenderer";
import { Markdown } from "./Markdown";
import { MermaidRenderer } from "./MermaidRenderer";
import { CsvRenderer } from "./CsvRenderer";
import { UIResourceRenderer } from '@mcp-ui/client';
import { HtmlRenderer } from "./HtmlRenderer";

// Helper function to check if content is a URL
function isUrl(content: string): boolean {
  return content.startsWith('http://') ||
    content.startsWith('https://') ||
    content.startsWith('data:') ||
    content.startsWith('blob:');
}

// Helper function to download attachment data
function downloadAttachment(data: string, filename: string, mimeType: string) {
  if (isUrl(data)) {
    // If data is already a URL, use downloadFromUrl
    downloadFromUrl(data, filename);
  } else {
    // If data is content, create blob and download
    const blob = new Blob([data], { type: mimeType });
    downloadBlob(blob, filename);
  }
}

// Helper function to create a data URL from content
function createDataUrl(content: string, mimeType: string): string {
  // If content is already a URL, return as-is
  if (isUrl(content)) {
    return content;
  }

  // Convert binary content to base64 for data URL
  const base64Content = btoa(content);
  return `data:${mimeType};base64,${base64Content}`;
}

// Component for image attachments with minimal styling
function ImageAttachment({ attachment, className }: {
  attachment: Attachment;
  className?: string;
}) {
  const mimeType = detectMimeType(attachment.data, attachment.name);
  const imageDataUrl = createDataUrl(attachment.data, mimeType);

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    downloadAttachment(attachment.data, attachment.name, mimeType);
  };

  return (
    <div className="relative group/image inline-block">
      <img
        src={imageDataUrl}
        alt={attachment.name}
        className={className || "max-w-full h-auto rounded-md"}
        draggable={false}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <button
          onClick={handleDownload}
          className="opacity-0 group-hover/image:opacity-100 transition-opacity duration-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 p-2 rounded-full shadow-lg cursor-pointer"
          title="Download image"
          aria-label={`Download ${attachment.name}`}
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function FileAttachment({ attachment, className }: { attachment: Attachment; className?: string }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const mimeType = detectMimeType(attachment.data, attachment.name);
    downloadAttachment(attachment.data, attachment.name, mimeType);
  };

  // Extract file extension
  const getFileExtension = (filename: string): string => {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()?.toUpperCase() || '' : '';
  };

  const fileExtension = getFileExtension(attachment.name);

  return (
    <div
      className={`relative inline-block cursor-pointer ${className || 'w-48 h-48'}`}
      onClick={handleDownload}
      title={`Download ${attachment.name}`}
    >
      {/* Main file container */}
      <div className="w-full h-full bg-neutral-100 dark:bg-neutral-800 rounded-md border-2 border-dashed border-neutral-300 dark:border-neutral-600 flex flex-col items-center justify-center p-4 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors">
        {/* File icon with extension overlay */}
        <div className="relative mb-3">
          <File className="w-12 h-12 text-neutral-500 dark:text-neutral-400" />
          {fileExtension && (
            <div className="absolute left-1/2 transform -translate-x-1/2 -bottom-2 bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded w-12 text-center">
              {fileExtension}
            </div>
          )}
        </div>

        {/* Filename */}
        <div className="text-sm text-neutral-700 dark:text-neutral-300 text-center font-medium w-full px-2">
          <div className="truncate">
            {attachment.name}
          </div>
        </div>

        {/* Download icon in corner */}
        <div className="absolute top-2 right-2 opacity-0 hover:opacity-100 transition-opacity">
          <Download className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
        </div>
      </div>
    </div>
  )
}

function UIAttachment({ attachment }: { attachment: Attachment }) {
  let mimeType: string;

  let text: string | undefined;
  let blob: string | undefined;

  if (attachment.type === AttachmentType.File) {
    const match = attachment.data.match(/^data:([^;]+)/);
    mimeType = match ? match[1] : detectMimeType(attachment.data, attachment.name);
    blob = attachment.data.split(',')[1];
  } else {
    mimeType = 'text/html';
    text = attachment.data;
  }

  const resource = {
    uri: attachment.name,
    mimeType: mimeType,
    ...(text && { text }),
    ...(blob && { blob }),
    _meta: attachment.meta
  };


  return (
    <UIResourceRenderer
      resource={resource}
      htmlProps={{
        autoResizeIframe: true
      }}
    />
  );
}

function HtmlAttachment({ attachment }: { attachment: Attachment }) {
  let html = attachment.data;

  if (attachment.type === AttachmentType.File) {
    html = atob(attachment.data.split(',')[1]);
  }

  return (
    <HtmlRenderer
      html={html}
      language="html"
      name={attachment.name}
    />
  );
}

function PdfAttachment({ attachment }: { attachment: Attachment }) {
  const mimeType = detectMimeType(attachment.data, attachment.name);
  const dataUrl = createDataUrl(attachment.data, mimeType);

  return (
    <PdfRenderer
      src={dataUrl}
      name={attachment.name}
    />
  );
}

function MarkdownAttachment({ attachment }: { attachment: Attachment }) {
  let md = attachment.data;

  if (attachment.type === AttachmentType.File) {
    md = atob(attachment.data.split(',')[1]);
  }

  return (
    <div className="markdown-attachment">
      <div className="prose dark:prose-invert max-w-none">
        <Markdown>{md}</Markdown>
      </div>
    </div>
  );
}

function CsvAttachment({ attachment }: { attachment: Attachment }) {
  let csv = attachment.data;

  if (attachment.type === AttachmentType.File) {
    csv = atob(attachment.data.split(',')[1]);
  }

  return (
    <CsvRenderer
      csv={csv}
      language="html"
      name={attachment.name}
    />
  );
}

function MermaidAttachment({ attachment }: { attachment: Attachment }) {
  let chart = attachment.data;

  if (attachment.type === AttachmentType.File) {
    chart = atob(attachment.data.split(',')[1]);
  }

  return (
    <MermaidRenderer
      chart={chart}
      language="html"
      name={attachment.name}
    />
  );
}

// Main attachment renderer with simple design
export function AttachmentRenderer({ attachment, className }: {
  attachment: Attachment;
  className?: string;
}) {
  const mimeType = detectMimeType(attachment.data, attachment.name);

  console.log('Rendering attachment:', attachment.name, 'with MIME type:', mimeType);

  if (attachment.name.startsWith('ui://') && 
      (mimeType === 'text/html' || 
       mimeType === 'text/uri-list' || 
       mimeType === 'application/vnd.mcp-ui.remote-dom')) {
    return <UIAttachment attachment={attachment} />;
  }

  if (mimeType.startsWith('image/')) {
    return <ImageAttachment attachment={attachment} className={className} />;
  }

  if (mimeType === 'text/csv') {
    return <CsvAttachment attachment={attachment} />;
  }

  if (mimeType === 'text/html') {
    return <HtmlAttachment attachment={attachment} />;
  }

  if (mimeType === 'text/markdown') {
    return <MarkdownAttachment attachment={attachment} />;
  }

  if (mimeType === 'text/vnd.mermaid') {
    return <MermaidAttachment attachment={attachment} />;
  }

  if (mimeType === 'application/pdf') {
    return <PdfAttachment attachment={attachment} />;
  }

  return <FileAttachment attachment={attachment} />;
}

// Single attachment display for full-screen view
export function SingleAttachmentDisplay({ attachment }: { attachment: Attachment }) {
  return (
    <div className="w-full">
      <AttachmentRenderer
        attachment={attachment}
        className="w-full h-auto max-h-96 rounded-md object-contain"
      />
    </div>
  );
}

// Multiple attachments display for list view with uniform tiles.
// Only images render a visual preview; other types render a file tile.
export function MultipleAttachmentsDisplay({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {attachments.map((attachment, index) => {
        const mimeType = detectMimeType(attachment.data, attachment.name);

        // Only show images as visual previews, everything else as file tiles
        if (mimeType.startsWith('image/')) {
          return (
            <div key={index} className="w-48 h-48 rounded-md overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors" title={attachment.name}>
              <ImageAttachment
                attachment={attachment}
                className="w-full h-full object-cover"
              />
            </div>
          );
        } else {
          // Everything else (video, audio, PDF, HTML, etc.) shows as file tile
          return (
            <FileAttachment
              key={index}
              attachment={attachment}
              className="w-48 h-48"
            />
          );
        }
      })}
    </div>
  );
}