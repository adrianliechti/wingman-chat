import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { CodeRenderer } from "@/shared/ui/CodeRenderer";

export function ActionProgress() {
  return (
    <>
      <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      <span className="sr-only">Working…</span>
    </>
  );
}

/** Keep recovery feedback readable; diagnostics and source remain available on demand. */
export function UiError({ title, detail, source }: { title: string; detail: string; source?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900/60 dark:bg-amber-950/20">
      <p role="alert" className="text-amber-900 dark:text-amber-200">
        {title}
      </p>
      <details
        className="mt-1 text-xs text-neutral-600 dark:text-neutral-400"
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">
          Technical details
        </summary>
        {expanded && (
          <div className="mt-2 min-w-0">
            <p className="whitespace-pre-wrap wrap-anywhere">{detail}</p>
            {source && <CodeRenderer code={source} language="json" />}
          </div>
        )}
      </details>
    </div>
  );
}
