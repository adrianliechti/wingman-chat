import { Columns2, History, RotateCcw, X } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { formatAbsoluteTime, formatRelativeTime } from "@/shared/lib/formatRelativeTime";
import type { ArtifactRevisionEntry } from "@/shared/types/artifact";
import { revisionActorLabel } from "./revisionLabels";

interface ArtifactRevisionBannerProps {
  entry: ArtifactRevisionEntry;
  /** Whether a line diff can be shown for this file kind. */
  canCompare: boolean;
  comparing: boolean;
  restoring: boolean;
  onToggleCompare: () => void;
  onRestore: () => void;
  onClose: () => void;
}

const action =
  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50";

/** Shown above the editor while an archived revision is pinned in the viewer. */
export function ArtifactRevisionBanner({
  entry,
  canCompare,
  comparing,
  restoring,
  onToggleCompare,
  onRestore,
  onClose,
}: ArtifactRevisionBannerProps) {
  return (
    <div
      role="status"
      className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-amber-200/70 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200"
    >
      <History size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-xs" title={formatAbsoluteTime(entry.createdAt)}>
        Viewing revision from {formatRelativeTime(entry.createdAt)}
        <span className="text-amber-700/70 dark:text-amber-300/60"> · {revisionActorLabel(entry)}</span>
      </span>
      {canCompare && (
        <button
          type="button"
          onClick={onToggleCompare}
          aria-pressed={comparing}
          className={cn(
            action,
            comparing
              ? "bg-amber-200/70 dark:bg-amber-400/20"
              : "hover:bg-amber-200/50 dark:hover:bg-amber-400/10",
          )}
        >
          <Columns2 size={12} />
          Compare
        </button>
      )}
      <button
        type="button"
        onClick={onRestore}
        disabled={restoring}
        className={cn(action, "hover:bg-amber-200/50 dark:hover:bg-amber-400/10")}
      >
        <RotateCcw size={12} />
        {restoring ? "Restoring…" : "Restore"}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Back to current version"
        title="Back to current version"
        className="p-1 rounded-md hover:bg-amber-200/50 dark:hover:bg-amber-400/10 transition-colors"
      >
        <X size={13} />
      </button>
    </div>
  );
}
