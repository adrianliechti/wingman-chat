import { Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { docxToHtml } from "@/shared/lib/docxToHtml";
import { getFileName } from "@/shared/lib/utils";
import { OfficeZoomControls } from "./OfficeZoomControls";
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
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [zoomState, setZoomState] = useState<{ document: string | null; value: number }>({
    document: null,
    value: 1,
  });
  const zoom = zoomState.document === html ? zoomState.value : 1;

  const syncZoom = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "wingman:docx-zoom", value: zoom }, "*");
  }, [zoom]);

  useEffect(syncZoom, [syncZoom]);

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
    <div className="flex h-full min-h-0 flex-col bg-neutral-100 dark:bg-neutral-900">
      <iframe
        ref={frameRef}
        srcDoc={html}
        className="min-h-0 flex-1 border-none bg-neutral-100 dark:bg-neutral-900"
        sandbox={OFFICE_IFRAME_SANDBOX}
        title={getFileName(path)}
        onLoad={syncZoom}
      />
      <div className="flex h-8 shrink-0 justify-end border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <OfficeZoomControls value={zoom} onChange={(value) => setZoomState({ document: html, value })} />
      </div>
    </div>
  );
});
