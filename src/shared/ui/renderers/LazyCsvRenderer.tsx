import { lazy, Suspense } from "react";
import { RendererFrame } from "./RendererFrame";

// Lazy boundary for CsvRenderer so @tanstack/react-table — only needed to render
// CSV/TSV blocks, which are rare — stays out of the initial bundle. The fallback
// mirrors CsvRenderer's own "loading" state while the chunk arrives.
const CsvRenderer = lazy(() => import("./CsvRenderer").then((m) => ({ default: m.CsvRenderer })));

interface CsvRendererProps {
  csv: string;
  language: string;
  name?: string;
}

export function LazyCsvRenderer({ csv, language, name }: CsvRendererProps) {
  return (
    <Suspense
      fallback={
        <RendererFrame label={language} name={name}>
          <div className="flex items-center justify-center h-24 text-neutral-500">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-600 dark:border-t-neutral-400" />
              <span>Loading CSV...</span>
            </div>
          </div>
        </RendererFrame>
      }
    >
      <CsvRenderer csv={csv} language={language} name={name} />
    </Suspense>
  );
}
