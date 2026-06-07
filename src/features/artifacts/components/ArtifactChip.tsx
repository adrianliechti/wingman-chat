import { File, PanelRightOpen } from "lucide-react";
import { memo } from "react";
import { cn } from "@/shared/lib/cn";
import { useArtifacts } from "../hooks/useArtifacts";

/**
 * Inline, clickable reference to an artifact file shown in the conversation
 * (e.g. when the assistant creates a file). Clicking opens the file in the
 * artifacts panel — created files are surfaced here rather than by auto-opening
 * the drawer.
 */
export const ArtifactChip = memo(function ArtifactChip({ path, className }: { path: string; className?: string }) {
  const { openFile, setShowArtifactsDrawer } = useArtifacts();

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
      title={`Open ${path}`}
      aria-label={`Open ${path}`}
      className={cn(
        "group/artifact inline-flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left align-top transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:hover:bg-neutral-700/60",
        "w-72 max-w-full",
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
        <span className="block truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">{name}</span>
        <span className="block text-xs text-neutral-400 dark:text-neutral-500">Open in artifacts</span>
      </span>

      <PanelRightOpen className="h-4 w-4 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover/artifact:opacity-100" />
    </button>
  );
});
