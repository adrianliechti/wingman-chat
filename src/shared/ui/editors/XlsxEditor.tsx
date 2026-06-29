import { Loader2 } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { xlsxToHtml } from "@/shared/lib/xlsxToHtml";
import { OfficeMarkdownEditor } from "./OfficeMarkdownEditor";
import { OFFICE_IFRAME_SANDBOX, useOfficeConversion } from "./useOfficeConversion";

interface XlsxEditorProps {
  path: string;
  content: string;
  contentType?: string;
}

/**
 * Spreadsheet preview: converts the workbook to styled HTML grids (see
 * `xlsxToHtml`) — cell formatting, merges, number formats — with Excel-style
 * sheet tabs along the bottom.
 *
 * Falls back to the extracted-markdown preview if conversion fails.
 */
export const XlsxEditor = memo(function XlsxEditor({ path, content, contentType }: XlsxEditorProps) {
  const { result, failed } = useOfficeConversion(path, content, contentType, xlsxToHtml);
  const [activeSheet, setActiveSheet] = useState(0);

  // New workbook → back to the first sheet
  useEffect(() => {
    setActiveSheet(0);
  }, [result]);

  if (failed) {
    return <OfficeMarkdownEditor path={path} content={content} contentType={contentType} />;
  }

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-sm text-neutral-400 dark:text-neutral-500 p-8">
        <Loader2 size={16} className="animate-spin" />
        Rendering spreadsheet…
      </div>
    );
  }

  const sheet = result.sheets[Math.min(activeSheet, result.sheets.length - 1)];

  return (
    <div className="h-full flex flex-col bg-white">
      <iframe
        srcDoc={sheet.html}
        className="flex-1 w-full border-none"
        sandbox={OFFICE_IFRAME_SANDBOX}
        title={sheet.name}
      />
      {result.sheets.length > 1 && (
        <div className="shrink-0 flex items-center gap-0.5 px-2 py-1 overflow-x-auto border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
          {result.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={cn(
                "shrink-0 px-3 py-1 text-xs rounded-t border-b-2 transition-colors",
                i === activeSheet
                  ? "border-green-600 text-neutral-900 dark:text-neutral-100 font-medium bg-white dark:bg-neutral-800"
                  : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
              )}
              title={s.name}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
