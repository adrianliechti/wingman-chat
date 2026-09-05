import { Download, File, PanelRightOpen } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { fileExtension } from "@/shared/lib/utils";
import { useArtifacts } from "../hooks/useArtifacts";

/**
 * Inline, clickable reference to an artifact file in the conversation; clicking
 * opens it in the artifacts panel. Greys out (non-clickable) when the file no
 * longer exists.
 */
export const ArtifactChip = memo(function ArtifactChip({ path, className }: { path: string; className?: string }) {
  const { fs, openFile, setShowArtifactsDrawer } = useArtifacts();

  // Optimistically assume the file exists to avoid a greyed-out flash; flip to
  // false only once a check confirms it's gone.
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
  const ext = fileExtension(name).toUpperCase();

  const handleOpen = () => {
    openFile(path);
    setShowArtifactsDrawer(true);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fs) return;
    fs.downloadFile(path).catch(() => {});
  };

  return (
    <div
      role="button"
      tabIndex={exists ? 0 : -1}
      onClick={exists ? handleOpen : undefined}
      onKeyDown={
        exists
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleOpen();
              }
            }
          : undefined
      }
      aria-disabled={!exists}
      title={exists ? `Open ${path}` : `${path} (no longer available)`}
      aria-label={exists ? `Open ${path}` : `${path} (no longer available)`}
      className={cn(
        "group/artifact inline-flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left align-top transition-colors",
        "max-w-xs",
        exists
          ? "cursor-pointer bg-neutral-100 hover:bg-neutral-200/70 dark:bg-neutral-900/40 dark:hover:bg-neutral-800/50"
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

      {exists && (
        <button
          type="button"
          onClick={handleDownload}
          title={`Download ${name}`}
          aria-label={`Download ${name}`}
          className="ml-1 -mr-1 shrink-0 rounded p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-300/60 hover:text-neutral-700 focus-visible:opacity-100 group-hover/artifact:opacity-100 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-100"
        >
          <Download className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
});
