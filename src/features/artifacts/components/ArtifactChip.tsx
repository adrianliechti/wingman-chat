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
        "group/artifact inline-flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left align-top transition-colors",
        "max-w-xs",
        exists
          ? "bg-neutral-100 hover:bg-neutral-200/70 dark:bg-neutral-900/40 dark:hover:bg-neutral-800/50"
          : "cursor-not-allowed bg-neutral-100/50 opacity-50 dark:bg-neutral-900/20",
        className,
      )}
    >
      <span className="relative h-7 w-7 shrink-0">
        <File
          className={cn(
            "h-7 w-7 text-neutral-400 dark:text-neutral-500 transition-opacity",
            exists && "group-hover/artifact:opacity-0",
          )}
          strokeWidth={1.5}
        />
        {ext && (
          <span
            className={cn(
              "absolute -bottom-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-500 px-1 text-[8px] font-bold leading-snug text-white transition-opacity dark:bg-neutral-600",
              exists && "group-hover/artifact:opacity-0",
            )}
          >
            {ext}
          </span>
        )}
        {exists && (
          <PanelRightOpen className="absolute inset-0 m-auto h-6 w-6 text-neutral-500 opacity-0 transition-opacity group-hover/artifact:opacity-100 dark:text-neutral-300" />
        )}
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm font-medium text-neutral-700 dark:text-neutral-200",
          !exists && "line-through",
        )}
      >
        {name}
      </span>
    </button>
  );
});
