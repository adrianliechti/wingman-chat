import { Download, File } from "lucide-react";
import mime from "mime";
import type { ContentPart, MessagePart } from "@tanstack/ai";
import { cn } from "@/shared/lib/cn";
import { dataUrlToBytes } from "@/shared/lib/fileContent";
import { isMediaPart, mediaDataUrl, mediaMimeType, mediaName, type MediaPart } from "@/shared/lib/messages";
import { downloadBlob, downloadFromUrl, fileExtension, formatBytes } from "@/shared/lib/utils";
import { Markdown } from "./Markdown";
import { HtmlRenderer } from "./renderers/HtmlRenderer";
import { LazyCsvRenderer } from "./renderers/LazyCsvRenderer";
import { PdfRenderer } from "./renderers/PdfRenderer";

/** A media part reduced to what the renderers need: its bytes or URL, a name, and a MIME type. */
interface Media {
  kind: MediaPart["type"];
  data: string;
  name?: string;
  mimeType: string;
}

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

  if (filename) {
    const mimeType = mime.getType(filename);
    if (mimeType) return mimeType;
  }

  return "application/octet-stream";
}

function toMedia(part: MediaPart): Media | null {
  const data = mediaDataUrl(part);
  if (!data) return null;
  const name = mediaName(part);
  return { kind: part.type, data, name, mimeType: mediaMimeType(part) ?? detectMimeType(data, name) };
}

function downloadContent(data: string, filename: string, mimeType: string) {
  if (isUrl(data)) {
    downloadFromUrl(data, filename);
  } else {
    const blob = new Blob([data], { type: mimeType });
    void downloadBlob(blob, filename);
  }
}

function getFilename(media: Media): string {
  if (media.name) return media.name;
  if (media.kind === "document") return "file";
  const ext = mime.getExtension(media.mimeType) || "bin";
  return `${media.kind}.${ext}`;
}

function createContentKeyFactory() {
  const seen = new Map<string, number>();

  return (media: Media) => {
    const baseKey = `${media.kind}:${getFilename(media)}:${media.data.slice(0, 64)}`;
    const occurrence = seen.get(baseKey) ?? 0;
    seen.set(baseKey, occurrence + 1);
    return occurrence === 0 ? baseKey : `${baseKey}:${occurrence}`;
  };
}

function ImageDisplay({ media, className }: { media: Media; className?: string }) {
  const filename = media.name || "image";

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    downloadContent(media.data, filename, media.mimeType);
  };

  return (
    <div className="relative group/image inline-block">
      <img src={media.data} alt={filename} className={className || "max-w-full h-auto rounded-md"} draggable={false} />
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

function fileSizeLabel(data: string): string | null {
  const parsed = dataUrlToBytes(data);
  return parsed ? formatBytes(parsed.bytes.length) : null;
}

function FileDisplay({ media, className }: { media: Media; className?: string }) {
  const name = getFilename(media);
  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    downloadContent(media.data, name, media.mimeType);
  };

  const ext = fileExtension(name).toUpperCase();
  const size = fileSizeLabel(media.data);

  return (
    <button
      type="button"
      onClick={handleDownload}
      title={`Download ${name}`}
      aria-label={`Download ${name}`}
      className={cn(
        "group/file inline-flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left align-top transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:hover:bg-neutral-700/60",
        "w-72 max-w-full",
        className,
      )}
    >
      <span className="relative shrink-0">
        <File className="h-9 w-9 text-neutral-400 dark:text-neutral-500" strokeWidth={1.5} />
        {ext && (
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-500 px-1 text-[8px] font-bold leading-snug text-white dark:bg-neutral-600">
            {ext}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">{name}</span>
        {size && <span className="block text-xs text-neutral-400 dark:text-neutral-500">{size}</span>}
      </span>

      <Download className="h-4 w-4 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover/file:opacity-100" />
    </button>
  );
}

function extractTextFromDataUrl(data: string): string {
  const parsed = dataUrlToBytes(data);
  if (parsed) {
    return new TextDecoder().decode(parsed.bytes);
  }
  return data;
}

function MediaDisplay({ media, className }: { media: Media; className?: string }) {
  if (media.kind === "image" || media.mimeType.startsWith("image/")) {
    return <ImageDisplay media={media} className={className} />;
  }
  if (media.kind === "document") {
    const name = getFilename(media);
    if (media.mimeType === "text/csv") {
      return <LazyCsvRenderer csv={extractTextFromDataUrl(media.data)} language="html" name={name} />;
    }
    if (media.mimeType === "text/html") {
      return <HtmlRenderer html={extractTextFromDataUrl(media.data)} language="html" name={name} />;
    }
    if (media.mimeType === "text/markdown") {
      return (
        <div className="markdown-content">
          <div className="prose dark:prose-invert max-w-none">
            <Markdown>{extractTextFromDataUrl(media.data)}</Markdown>
          </div>
        </div>
      );
    }
    if (media.mimeType === "application/pdf") {
      return <PdfRenderer src={media.data} name={name} />;
    }
  }
  // Audio and video render as a downloadable file for now.
  return <FileDisplay media={media} className={className} />;
}

/** One media part: images and previewable documents show a preview; other files a download chip. */
export function ContentRenderer({ content, className }: { content: ContentPart | MessagePart; className?: string }) {
  if (!isMediaPart(content)) return null;
  const media = toMedia(content);
  return media ? <MediaDisplay media={media} className={className} /> : null;
}

function isImage(media: Media): boolean {
  return media.kind === "image" || media.mimeType.startsWith("image/");
}

// Single content: images/previewable files render their own preview; other files
// render as a compact chip (sized to its content, not the full chat width).
function SingleContentDisplay({ media }: { media: Media }) {
  if (media.kind === "image") {
    return (
      <div className="w-full">
        <ImageDisplay media={media} className="max-h-96 w-auto rounded-md object-contain" />
      </div>
    );
  }
  return <MediaDisplay media={media} />;
}

function MultipleContentsDisplay({ contents }: { contents: Media[] }) {
  const getContentKey = createContentKeyFactory();
  const images = contents.filter(isImage);
  const files = contents.filter((media) => !isImage(media));

  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((media) => (
            <div
              key={getContentKey(media)}
              className="h-32 w-32 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800"
              title={getFilename(media)}
            >
              <ImageDisplay media={media} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((media) => (
            <FileDisplay key={getContentKey(media)} media={media} className="w-64" />
          ))}
        </div>
      )}
    </div>
  );
}

/** The media parts of a message or tool output, as previews and download chips. */
export function RenderContents({ contents }: { contents: readonly (ContentPart | MessagePart)[] }) {
  const media = contents.filter(isMediaPart).flatMap((part) => {
    const item = toMedia(part);
    return item ? [item] : [];
  });

  if (media.length === 0) {
    return null;
  }

  if (media.length === 1) {
    return <SingleContentDisplay media={media[0]} />;
  }

  return <MultipleContentsDisplay contents={media} />;
}
