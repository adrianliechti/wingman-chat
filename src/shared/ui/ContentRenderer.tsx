import { File, Download } from "lucide-react";
import type { Content, ImageContent, FileContent } from "@/shared/types/chat";
import { downloadBlob, downloadFromUrl, parseDataUrl } from "@/shared/lib/utils";
import { PdfRenderer } from "./renderers/PdfRenderer";
import { Markdown } from "./Markdown";
import { MermaidRenderer } from "./renderers/MermaidRenderer";
import { CsvRenderer } from "./renderers/CsvRenderer";
import { HtmlRenderer } from "./renderers/HtmlRenderer";
import mime from 'mime';

// Helper function to check if content is a URL
function isUrl(content: string): boolean {
  return content.startsWith('http://') ||
    content.startsWith('https://') ||
    content.startsWith('data:') ||
    content.startsWith('blob:');
}

function detectMimeType(data: string, filename?: string): string {
  if (data.startsWith('data:')) {
    const mimeMatch = data.match(/^data:([^;]+)/);
    if (mimeMatch) return mimeMatch[1];
  }
  
  // Use mime library to get MIME type from file extension
  if (filename) {
    const mimeType = mime.getType(filename);
    if (mimeType) return mimeType;
  }
  
  return 'application/octet-stream';
}

// Helper function to download content data
function downloadContent(data: string, filename: string, mimeType: string) {
  if (isUrl(data)) {
    // If data is already a URL, use downloadFromUrl
    downloadFromUrl(data, filename);
  } else {
    // If data is content, create blob and download
    const blob = new Blob([data], { type: mimeType });
    downloadBlob(blob, filename);
  }
}

// Helper to get filename from content
function getFilename(content: Content): string {
  if (content.type === 'file') return content.name;
  if (content.type === 'image' && content.name) return content.name;
  if (content.type === 'audio' && content.name) return content.name;
  
  // Generate name from mime type for image/audio/file
  if (content.type === 'image' || content.type === 'audio') {
    const mimeType = detectMimeType(content.data);
    const ext = mime.getExtension(mimeType) || 'bin';
    return `${content.type}.${ext}`;
  }
  
  return 'file';
}

// Component for image content with minimal styling
function ImageDisplay({ content, className }: {
  content: ImageContent;
  className?: string;
}) {
  const filename = content.name || 'image';
  const mimeType = detectMimeType(content.data, filename);

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    downloadContent(content.data, filename, mimeType);
  };

  return (
    <div className="relative group/image inline-block">
      <img
        src={content.data}
        alt={filename}
        className={className || "max-w-full h-auto rounded-md"}
        draggable={false}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <button
          onClick={handleDownload}
          className="opacity-0 group-hover/image:opacity-100 transition-opacity duration-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 p-2 rounded-full shadow-lg"
          title="Download image"
          aria-label={`Download ${filename}`}
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function FileDisplay({ content, className }: { content: FileContent; className?: string }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const mimeType = detectMimeType(content.data, content.name);
    downloadContent(content.data, content.name, mimeType);
  };

  // Extract file extension
  const getFileExtension = (filename: string): string => {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()?.toUpperCase() || '' : '';
  };

  const fileExtension = getFileExtension(content.name);

  return (
    <div
      className={`relative inline-block cursor-pointer ${className || 'w-48 h-48'}`}
      onClick={handleDownload}
      title={`Download ${content.name}`}
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
            {content.name}
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

// Extract text content from data URL (decode base64)
function extractTextFromDataUrl(data: string): string {
  const parsed = parseDataUrl(data);
  if (parsed) {
    return atob(parsed.data);
  }
  return data;
}

function HtmlDisplay({ content }: { content: FileContent }) {
  const html = extractTextFromDataUrl(content.data);

  return (
    <HtmlRenderer
      html={html}
      language="html"
      name={content.name}
    />
  );
}

function PdfDisplay({ content }: { content: FileContent }) {
  return (
    <PdfRenderer
      src={content.data}
      name={content.name}
    />
  );
}

function MarkdownDisplay({ content }: { content: FileContent }) {
  const md = extractTextFromDataUrl(content.data);

  return (
    <div className="markdown-content">
      <div className="prose dark:prose-invert max-w-none">
        <Markdown>{md}</Markdown>
      </div>
    </div>
  );
}

function CsvDisplay({ content }: { content: FileContent }) {
  const csv = extractTextFromDataUrl(content.data);

  return (
    <CsvRenderer
      csv={csv}
      language="html"
      name={content.name}
    />
  );
}

function MermaidDisplay({ content }: { content: FileContent }) {
  const chart = extractTextFromDataUrl(content.data);

  return (
    <MermaidRenderer
      chart={chart}
      language="html"
      name={content.name}
    />
  );
}

// Main content renderer with simple design
export function ContentRenderer({ content, className }: {
  content: Content;
  className?: string;
}) {
  // Handle text content - not rendered by this component
  if (content.type === 'text' || content.type === 'reasoning' || content.type === 'tool_call' || content.type === 'tool_result') {
    return null;
  }

  // Handle image content
  if (content.type === 'image') {
    return <ImageDisplay content={content} className={className} />;
  }

  // Handle audio content - render as file for now
  if (content.type === 'audio') {
    const filename = content.name || 'audio.mp3';
    const fileContent: FileContent = { type: 'file', name: filename, data: content.data };
    return <FileDisplay content={fileContent} className={className} />;
  }

  // Handle file content based on mime type
  if (content.type === 'file') {
    const mimeType = detectMimeType(content.data, content.name);

    if (mimeType.startsWith('image/')) {
      const imageContent: ImageContent = { type: 'image', name: content.name, data: content.data };
      return <ImageDisplay content={imageContent} className={className} />;
    }

    if (mimeType === 'text/csv') {
      return <CsvDisplay content={content} />;
    }

    if (mimeType === 'text/html') {
      return <HtmlDisplay content={content} />;
    }

    if (mimeType === 'text/markdown') {
      return <MarkdownDisplay content={content} />;
    }

    if (mimeType === 'text/vnd.mermaid') {
      return <MermaidDisplay content={content} />;
    }

    if (mimeType === 'application/pdf') {
      return <PdfDisplay content={content} />;
    }

    return <FileDisplay content={content} className={className} />;
  }

  return null;
}

// Single content display for full-screen view (internal)
function SingleContentDisplay({ content }: { content: Content }) {
  return (
    <div className="w-full">
      <ContentRenderer
        content={content}
        className="w-full h-auto max-h-96 rounded-md object-contain"
      />
    </div>
  );
}

// Multiple contents display for list view with uniform tiles (internal)
// Only images render a visual preview; other types render a file tile.
function MultipleContentsDisplay({ contents }: { contents: Content[] }) {
  // Filter to only renderable content (images, files, audio)
  const renderableContents = contents.filter(c => 
    c.type === 'image' || c.type === 'file' || c.type === 'audio'
  );

  return (
    <div className="flex flex-wrap gap-3">
      {renderableContents.map((content, index) => {
        const mimeType = content.type === 'image' 
          ? detectMimeType(content.data, content.name)
          : content.type === 'file'
            ? detectMimeType(content.data, content.name)
            : 'audio/mpeg';

        // Only show images as visual previews, everything else as file tiles
        if (content.type === 'image' || (content.type === 'file' && mimeType.startsWith('image/'))) {
          const imageContent = content.type === 'image' 
            ? content 
            : { type: 'image' as const, name: content.name, data: content.data };
          return (
            <div key={index} className="w-48 h-48 rounded-md overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors" title={getFilename(content)}>
              <ImageDisplay
                content={imageContent}
                className="w-full h-full object-cover"
              />
            </div>
          );
        } else if (content.type === 'file') {
          // Everything else (video, audio, PDF, HTML, etc.) shows as file tile
          return (
            <FileDisplay
              key={index}
              content={content}
              className="w-48 h-48"
            />
          );
        } else if (content.type === 'audio') {
          const filename = content.name || 'audio.mp3';
          const fileContent: FileContent = { type: 'file', name: filename, data: content.data };
          return (
            <FileDisplay
              key={index}
              content={fileContent}
              className="w-48 h-48"
            />
          );
        }
        return null;
      })}
    </div>
  );
}

// Render contents - automatically chooses single or multiple layout
export function RenderContents({ contents }: { contents: Content[] }) {
  // Filter to only renderable content (images, files, audio)
  const renderableContents = contents.filter(c => 
    c.type === 'image' || c.type === 'file' || c.type === 'audio'
  );

  if (renderableContents.length === 0) {
    return null;
  }

  if (renderableContents.length === 1) {
    return <SingleContentDisplay content={renderableContents[0]} />;
  }

  return <MultipleContentsDisplay contents={renderableContents} />;
}
