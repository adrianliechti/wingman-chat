import { Loader2 } from "lucide-react";
import { memo } from "react";
import { docxToHtml } from "@/shared/lib/docxToHtml";
import { getFileName } from "@/shared/lib/utils";
import { OfficeMarkdownEditor } from "./OfficeMarkdownEditor";
import { OFFICE_IFRAME_SANDBOX, useOfficeConversion } from "./useOfficeConversion";

interface DocxEditorProps {
  path: string;
  content: string;
  contentType?: string;
}

/**
 * High-fidelity DOCX preview: converts the document to a single HTML page
 * stack (see `docxToHtml`) and renders it in a sandboxed iframe — white
 * pages on a gray canvas, like the PDF viewer.
 *
 * Falls back to the extracted-markdown preview if conversion fails.
 */
export const DocxEditor = memo(function DocxEditor({ path, content, contentType }: DocxEditorProps) {
  const { result: html, failed } = useOfficeConversion(path, content, contentType, docxToHtml);

  if (failed) {
    return <OfficeMarkdownEditor path={path} content={content} contentType={contentType} />;
  }

  if (html === null) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-sm text-neutral-400 dark:text-neutral-500 p-8">
        <Loader2 size={16} className="animate-spin" />
        Rendering document…
      </div>
    );
  }

  return (
    <iframe
      srcDoc={html}
      className="w-full h-full border-none bg-neutral-100 dark:bg-neutral-900"
      sandbox={OFFICE_IFRAME_SANDBOX}
      title={getFileName(path)}
    />
  );
});
