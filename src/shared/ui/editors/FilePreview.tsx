import { lazyRouteComponent } from "@tanstack/react-router";
import { File as FileGlyph, Loader2 } from "lucide-react";
import { Suspense } from "react";
import { artifactKind, artifactLanguage } from "@/features/artifacts/lib/artifacts";
import { getFileName } from "@/shared/lib/utils";

// The same on-demand editors the artifacts drawer uses, so a document looks the
// same wherever it is shown. Each pulls in heavy, format-specific dependencies.
const DocxEditor = lazyRouteComponent(() => import("./DocxEditor"), "DocxEditor");
const HtmlEditor = lazyRouteComponent(() => import("./HtmlEditor"), "HtmlEditor");
const MarkdownEditor = lazyRouteComponent(() => import("./MarkdownEditor"), "MarkdownEditor");
const MediaEditor = lazyRouteComponent(() => import("./MediaEditor"), "MediaEditor");
const MermaidEditor = lazyRouteComponent(() => import("./MermaidEditor"), "MermaidEditor");
const OfficeMarkdownEditor = lazyRouteComponent(() => import("./OfficeMarkdownEditor"), "OfficeMarkdownEditor");
const PdfEditor = lazyRouteComponent(() => import("./PdfEditor"), "PdfEditor");
const PptxEditor = lazyRouteComponent(() => import("./PptxEditor"), "PptxEditor");
const SvgEditor = lazyRouteComponent(() => import("./SvgEditor"), "SvgEditor");
const TextEditor = lazyRouteComponent(() => import("./TextEditor"), "TextEditor");
const XlsxEditor = lazyRouteComponent(() => import("./XlsxEditor"), "XlsxEditor");

export interface FilePreviewProps {
  /** File name or path; decides the viewer together with `contentType`. */
  path: string;
  /** UTF-8 text for text files, a data URL for binary ones. */
  content: string;
  contentType?: string;
}

function Viewer({ path, content, contentType }: FilePreviewProps) {
  const kind = artifactKind(path, contentType);
  switch (kind) {
    case "image":
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-neutral-50 p-6 dark:bg-neutral-900/60">
          <img
            src={content}
            alt={getFileName(path)}
            className="max-h-full max-w-full rounded-md object-contain shadow-sm"
            draggable={false}
          />
        </div>
      );
    case "audio":
    case "video":
      return <MediaEditor path={path} content={content} contentType={contentType} />;
    case "pdf":
      return <PdfEditor content={content} />;
    case "pptx":
      return <PptxEditor path={path} content={content} contentType={contentType} />;
    case "docx":
      return <DocxEditor path={path} content={content} contentType={contentType} />;
    case "xlsx":
      return <XlsxEditor path={path} content={content} contentType={contentType} />;
    case "email":
      return <OfficeMarkdownEditor path={path} content={content} contentType={contentType} />;
    case "html":
      return <HtmlEditor path={path} content={content} />;
    case "svg":
      return <SvgEditor content={content} />;
    case "mermaid":
      return <MermaidEditor content={content} />;
    case "markdown":
      return <MarkdownEditor content={content} path={path} />;
    case "binary":
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md text-center">
            <FileGlyph size={32} className="mx-auto mb-4 text-neutral-300 dark:text-neutral-600" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">This file has no preview.</p>
            <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
              {contentType || "application/octet-stream"}
            </p>
          </div>
        </div>
      );
    case "code":
      return <TextEditor content={content} language={artifactLanguage(path)} />;
    default:
      return <TextEditor content={content} />;
  }
}

/**
 * Read-only view of one file, chosen by its type: office documents and PDFs
 * render page by page, markdown as prose, code with highlighting, media in a
 * player. The caller owns the surrounding frame and any actions.
 */
export function FilePreview({ path, content, contentType }: FilePreviewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400 dark:text-neutral-500" />
        </div>
      }
    >
      <Viewer key={`${path}\0${contentType ?? ""}`} path={path} content={content} contentType={contentType} />
    </Suspense>
  );
}
