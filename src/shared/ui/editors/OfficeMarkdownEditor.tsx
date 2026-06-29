import { memo, useEffect, useState } from "react";
import { convertFileToText } from "@/shared/lib/convert";
import { dataUrlToBytes } from "@/shared/lib/fileContent";
import { getFileName } from "@/shared/lib/utils";
import { MarkdownEditor } from "./MarkdownEditor";

interface OfficeMarkdownEditorProps {
  path: string;
  content: string;
  contentType?: string;
  viewMode?: "code" | "preview";
  onViewModeChange?: (mode: "code" | "preview") => void;
}

/**
 * Preview for binary office documents (docx, pptx, …) that runs the file
 * through the shared extractor (backend if configured, else built-in client
 * converters) to produce Markdown, then renders it with MarkdownEditor.
 *
 * Same pipeline used for uploads — keeps generated artifacts and uploaded
 * files visually consistent.
 */
export const OfficeMarkdownEditor = memo(function OfficeMarkdownEditor({
  path,
  content,
  contentType,
  viewMode,
  onViewModeChange,
}: OfficeMarkdownEditorProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setMarkdown(null);

    const parsed = dataUrlToBytes(content);
    if (!parsed) {
      setError("Unable to decode file data.");
      return;
    }

    // `.slice()` narrows the array's backing buffer from ArrayBufferLike
    // (which TS treats as possibly SharedArrayBuffer) to a fresh ArrayBuffer,
    // satisfying BlobPart under strict lib types.
    const file = new File([parsed.bytes.slice()], getFileName(path), {
      type: contentType ?? parsed.mimeType,
    });

    convertFileToText(file)
      .then((text) => {
        if (!cancelled) setMarkdown(text);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to extract document text");
      });

    return () => {
      cancelled = true;
    };
  }, [path, content, contentType]);

  if (error) {
    return <div className="h-full flex items-center justify-center text-sm text-red-500 p-8">{error}</div>;
  }

  if (markdown === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-neutral-400 dark:text-neutral-500 p-8">
        Extracting…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Disclosure: this is extracted text, not a fidelity-preserving render.
          Lives here (not in the drawer) so it also covers the fallback paths
          taken when a high-fidelity preview fails to convert. */}
      <div className="shrink-0 px-3 py-1 text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-100/80 dark:bg-neutral-800/60 border-b border-black/5 dark:border-white/5">
        Text preview — original formatting is not shown. Download the file for the original.
      </div>
      <div className="flex-1 min-h-0">
        <MarkdownEditor content={markdown} path={path} viewMode={viewMode} onViewModeChange={onViewModeChange} />
      </div>
    </div>
  );
});
