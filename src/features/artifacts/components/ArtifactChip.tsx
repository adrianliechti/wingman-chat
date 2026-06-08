import { File, PanelRightOpen } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { useArtifacts } from "../hooks/useArtifacts";

/**
 * Inline, clickable reference to an artifact file shown in the conversation
 * (e.g. when the assistant creates a file, or a user attaches one). Clicking
 * opens the file in the artifacts panel — created files are surfaced here
 * rather than by auto-opening the drawer. When the target file no longer
 * exists, the chip greys out and is no longer clickable.
 */
export const ArtifactChip = memo(function ArtifactChip({ path, className }: { path: string; className?: string }) {
  const { fs, openFile, setShowArtifactsDrawer } = useArtifacts();

  // Optimistically assume the file exists to avoid a greyed-out flash; flip to
  // false only once a check confirms it's gone. Re-checks on filesystem changes
  // so deleting (or recreating) the file updates the chip live.
  const [exists, setExists] = useState(true);

  useEffect(() => {
    if (!fs) return undefined;
    let cancelled = false;
    const check = () => {
      fs.fileExists(path)
        .then((ok) => {
          if (!cancelled) setExists(ok);
        })
        .catch(() => {});
    };
    check();
    const unsubscribe = [
      fs.subscribe("fileDeleted", check),
      fs.subscribe("fileCreated", check),
      fs.subscribe("fileRenamed", check),
    ];
    return () => {
      cancelled = true;
      for (const off of unsubscribe) off();
    };
  }, [fs, path]);

  const name = path.split("/").pop() || path;
  const ext = (name.includes(".") ? name.split(".").pop() : "")?.toUpperCase() ?? "";

  const handleOpen = () => {
    openFile(path);
    setShowArtifactsDrawer(true);
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={!exists}
      title={exists ? `Open ${path}` : `${path} (no longer available)`}
      aria-label={exists ? `Open ${path}` : `${path} (no longer available)`}
      className={cn(
        "group/artifact inline-flex items-center gap-3 rounded-lg border px-3 py-2 text-left align-top transition-colors",
        "w-72 max-w-full",
        exists
          ? "border-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:hover:bg-neutral-700/60"
          : "cursor-not-allowed border-neutral-200/60 bg-neutral-50/50 opacity-50 dark:border-neutral-700/50 dark:bg-neutral-800/30",
        className,
      )}
    >
      <span className="relative shrink-0">
        <File className="h-9 w-9 text-neutral-400 dark:text-neutral-500" strokeWidth={1.5} />
        {ext && (
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded bg-neutral-500 px-1 text-[8px] font-bold leading-snug text-white dark:bg-neutral-600">
            {ext}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-medium text-neutral-700 dark:text-neutral-200",
            !exists && "line-through",
          )}
        >
          {name}
        </span>
        <span className="block text-xs text-neutral-400 dark:text-neutral-500">
          {exists ? "Open in artifacts" : "No longer available"}
        </span>
      </span>

      {exists && (
        <PanelRightOpen className="h-4 w-4 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover/artifact:opacity-100" />
      )}
    </button>
  );
});
