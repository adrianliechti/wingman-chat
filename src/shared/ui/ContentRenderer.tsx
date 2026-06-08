import { Download, File } from "lucide-react";
import mime from "mime";
import { cn } from "@/shared/lib/cn";
import { dataUrlToBytes } from "@/shared/lib/fileContent";
import { downloadBlob, downloadFromUrl, formatBytes, getFileExt } from "@/shared/lib/utils";
import type { AudioContent, Content, FileContent, ImageContent } from "@/shared/types/chat";
import { Markdown } from "./Markdown";
import { CsvRenderer } from "./renderers/CsvRenderer";
import { HtmlRenderer } from "./renderers/HtmlRenderer";
import { PdfRenderer } from "./renderers/PdfRenderer";

type RenderableContent = AudioContent | FileContent | ImageContent;

// Helper function to check if content is a URL
function isUrl(content: string): boolean {
  return (
    content.startsWith("http://") ||
    content.startsWith("https://") ||
    content.startsWith("data:") ||
    content.startsWith("blob:")
  );
}

function detectMimeType(data: string, filename?: string): string {
  if (data.startsWith("data:")) {
    const mimeMatch = data.match(/^data:([^;]+)/);
    if (mimeMatch) return mimeMatch[1];
  }

  // Use mime library to get MIME type from file extension
  if (filename) {
    const mimeType = mime.getType(filename);
    if (mimeType) return mimeType;
  }

  return "application/octet-stream";
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
function getFilename(content: RenderableContent): string {
  if (content.type === "file") return content.name;
  if (content.type === "image" && content.name) return content.name;
  if (content.type === "audio" && content.name) return content.name;

  // Generate name from mime type for image/audio/file
  if (content.type === "image" || content.type === "audio") {
    const mimeType = detectMimeType(content.data);
    const ext = mime.getExtension(mimeType) || "bin";
    return `${content.type}.${ext}`;
  }

  return "file";
}

function createContentKeyFactory() {
  const seen = new Map<string, number>();

  return (content: RenderableContent) => {
    const baseKey = `${content.type}:${getFilename(content)}:${content.data.slice(0, 64)}`;
    const occurrence = seen.get(baseKey) ?? 0;
    seen.set(baseKey, occurrence + 1);
    return occurrence === 0 ? baseKey : `${baseKey}:${occurrence}`;
  };
}

// Component for image content with minimal styling
function ImageDisplay({ content, className }: { content: ImageContent; className?: string }) {
  const filename = content.name || "image";
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
          type="button"
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

// Byte size of a data URL payload, formatted (e.g. "17.1 KB"), or null if not a data URL.
function fileSizeLabel(data: string): string | null {
  const parsed = dataUrlToBytes(data);
  return parsed ? formatBytes(parsed.bytes.length) : null;
}

// Compact horizontal "attachment" chip: icon + filename + size, click to download.
function FileDisplay({ content, className }: { content: FileContent; className?: string }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const mimeType = detectMimeType(content.data, content.name);
    downloadContent(content.data, content.name, mimeType);
  };

  const ext = getFileExt(content.name).slice(1).toUpperCase();
  const size = fileSizeLabel(content.data);

  return (
    <button
      type="button"
      onClick={handleDownload}
      title={`Download ${content.name}`}
      aria-label={`Download ${content.name}`}
      className={cn(
        "group/file inline-flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left align-top transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:hover:bg-neutral-700/60",
        "w-72 max-w-full",
        className,
      )}
    >
      {/* File icon with extension badge */}
      <span className="relative shrink-0">
        <File className="h-9 w-9 text-neutral-400 dark:text-neutral-500" strokeWidth={1.5} />
        {ext && (
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded bg-neutral-500 px-1 text-[8px] font-bold leading-snug text-white dark:bg-neutral-600">
            {ext}
          </span>
        )}
      </span>

      {/* Filename + size */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {content.name}
        </span>
        {size && <span className="block text-xs text-neutral-400 dark:text-neutral-500">{size}</span>}
      </span>

      <Download className="h-4 w-4 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover/file:opacity-100" />
    </button>
  );
}

// Extract text content from data URL (UTF-8 decode the base64 payload)
function extractTextFromDataUrl(data: string): string {
  const parsed = dataUrlToBytes(data);
  if (parsed) {
    return new TextDecoder().decode(parsed.bytes);
  }
  return data;
}

function HtmlDisplay({ content }: { content: FileContent }) {
  const html = extractTextFromDataUrl(content.data);

  return <HtmlRenderer html={html} language="html" name={content.name} />;
}

function PdfDisplay({ content }: { content: FileContent }) {
  return <PdfRenderer src={content.data} name={content.name} />;
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

  return <CsvRenderer csv={csv} language="html" name={content.name} />;
}

// Main content renderer with simple design
export function ContentRenderer({ content, className }: { content: Content; className?: string }) {
  // Handle text content - not rendered by this component
  if (
    content.type === "text" ||
    content.type === "reasoning" ||
    content.type === "tool_call" ||
    content.type === "tool_result"
  ) {
    return null;
  }

  // Handle image content
  if (content.type === "image") {
    return <ImageDisplay content={content} className={className} />;
  }

  // Handle audio content - render as file for now
  if (content.type === "audio") {
    const filename = content.name || "audio.mp3";
    const fileContent: FileContent = { type: "file", name: filename, data: content.data };
    return <FileDisplay content={fileContent} className={className} />;
  }

  // Handle file content based on mime type
  if (content.type === "file") {
    const mimeType = detectMimeType(content.data, content.name);

    if (mimeType.startsWith("image/")) {
      const imageContent: ImageContent = { type: "image", name: content.name, data: content.data };
      return <ImageDisplay content={imageContent} className={className} />;
    }

    if (mimeType === "text/csv") {
      return <CsvDisplay content={content} />;
    }

    if (mimeType === "text/html") {
      return <HtmlDisplay content={content} />;
    }

    if (mimeType === "text/markdown") {
      return <MarkdownDisplay content={content} />;
    }

    if (mimeType === "application/pdf") {
      return <PdfDisplay content={content} />;
    }

    return <FileDisplay content={content} className={className} />;
  }

  return null;
}

// True when a content block should render as an inline image (preview) rather than a chip.
function isImageContent(content: RenderableContent): boolean {
  if (content.type === "image") return true;
  if (content.type === "file") return detectMimeType(content.data, content.name).startsWith("image/");
  return false;
}

function asImage(content: RenderableContent): ImageContent {
  return content.type === "image" ? content : { type: "image", name: content.name, data: content.data };
}

function asFile(content: RenderableContent): FileContent {
  return content.type === "file" ? content : { type: "file", name: content.name || "audio.mp3", data: content.data };
}

// Single content: images/previewable files render their own preview; other files
// render as a compact chip (sized to its content, not the full chat width).
function SingleContentDisplay({ content }: { content: Content }) {
  if (content.type === "image") {
    return (
      <div className="w-full">
        <ImageDisplay content={content} className="max-h-96 w-auto rounded-md object-contain" />
      </div>
    );
  }
  return <ContentRenderer content={content} />;
}

// Multiple contents: a row of image thumbnails followed by a row of file chips.
function MultipleContentsDisplay({ contents }: { contents: RenderableContent[] }) {
  const getContentKey = createContentKeyFactory();
  const images = contents.filter(isImageContent);
  const files = contents.filter((c) => !isImageContent(c));

  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((content) => (
            <div
              key={getContentKey(content)}
              className="h-32 w-32 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800"
              title={getFilename(content)}
            >
              <ImageDisplay content={asImage(content)} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((content) => (
            <FileDisplay key={getContentKey(content)} content={asFile(content)} className="w-64" />
          ))}
        </div>
      )}
    </div>
  );
}

// Render contents - automatically chooses single or multiple layout
export function RenderContents({ contents }: { contents: Content[] }) {
  // Filter to only renderable content (images, files, audio)
  const renderableContents = contents.filter(
    (c): c is RenderableContent => c.type === "image" || c.type === "file" || c.type === "audio",
  );

  if (renderableContents.length === 0) {
    return null;
  }

  if (renderableContents.length === 1) {
    return <SingleContentDisplay content={renderableContents[0]} />;
  }

  return <MultipleContentsDisplay contents={renderableContents} />;
}
