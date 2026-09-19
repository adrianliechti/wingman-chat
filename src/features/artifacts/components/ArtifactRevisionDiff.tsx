import { diffLines } from "diff";
import { useMemo } from "react";
import { cn } from "@/shared/lib/cn";

interface ArtifactRevisionDiffProps {
  /** The archived revision being compared. */
  before: string;
  /** The live file. */
  after: string;
}

type Row = { kind: "add" | "remove" | "same"; text: string } | { kind: "skip"; count: number };

/** Unchanged runs longer than this are collapsed to a single summary row. */
const CONTEXT_LINES = 3;

function toRows(before: string, after: string): Row[] {
  const rows: Row[] = [];
  const parts = diffLines(before, after);
  parts.forEach((part, index) => {
    const lines = part.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (part.added) {
      for (const text of lines) rows.push({ kind: "add", text });
      return;
    }
    if (part.removed) {
      for (const text of lines) rows.push({ kind: "remove", text });
      return;
    }
    const first = index === 0;
    const last = index === parts.length - 1;
    const keepHead = first ? 0 : CONTEXT_LINES;
    const keepTail = last ? 0 : CONTEXT_LINES;
    if (lines.length > keepHead + keepTail + 1) {
      for (const text of lines.slice(0, keepHead)) rows.push({ kind: "same", text });
      rows.push({ kind: "skip", count: lines.length - keepHead - keepTail });
      for (const text of lines.slice(lines.length - keepTail)) rows.push({ kind: "same", text });
    } else {
      for (const text of lines) rows.push({ kind: "same", text });
    }
  });
  return rows;
}

/** Line diff between an archived revision and the current file. */
export function ArtifactRevisionDiff({ before, after }: ArtifactRevisionDiffProps) {
  const rows = useMemo(() => toRows(before, after), [before, after]);
  const changed = rows.some((row) => row.kind === "add" || row.kind === "remove");

  if (!changed) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          This revision matches the current file.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white dark:bg-neutral-950">
      <pre className="min-w-full w-max text-xs leading-5 font-mono">
        {rows.map((row, index) =>
          row.kind === "skip" ? (
            <div
              key={index}
              className="px-3 text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-900/60 select-none"
            >
              … {row.count} unchanged {row.count === 1 ? "line" : "lines"}
            </div>
          ) : (
            <div
              key={index}
              className={cn(
                "px-3 whitespace-pre",
                row.kind === "add" && "bg-green-500/10 text-green-800 dark:text-green-300",
                row.kind === "remove" && "bg-red-500/10 text-red-800 dark:text-red-300",
                row.kind === "same" && "text-neutral-600 dark:text-neutral-400",
              )}
            >
              <span className="inline-block w-4 select-none text-neutral-400 dark:text-neutral-500">
                {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}
              </span>
              {row.text || " "}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}
