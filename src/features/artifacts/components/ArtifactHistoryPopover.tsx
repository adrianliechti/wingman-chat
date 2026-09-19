import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { History } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArtifactRevisionListing, FileSystemManager } from "@/features/artifacts/lib/fs";
import { cn } from "@/shared/lib/cn";
import { formatAbsoluteTime, formatRelativeTime } from "@/shared/lib/formatRelativeTime";
import { formatBytes } from "@/shared/lib/utils";
import { PANEL_CLASS } from "@/shared/ui/menuStyles";
import { revisionActorLabel } from "./revisionLabels";

interface ArtifactHistoryPopoverProps {
  fs: FileSystemManager;
  path: string;
  /** Hovering a row previews it; leaving the list reports null. */
  onPeek: (entry: ArtifactRevisionListing | null) => void;
  /** Clicking a row keeps it in the viewer with restore/compare actions. */
  onPin: (entry: ArtifactRevisionListing) => void;
}

/** Toolbar button that lists a file's archived revisions, newest first. */
export function ArtifactHistoryPopover({ fs, path, onPeek, onPin }: ArtifactHistoryPopoverProps) {
  return (
    <Popover>
      <PopoverButton
        className="p-2 md:p-1.5 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 data-open:bg-black/5 dark:data-open:bg-white/5 focus-visible:outline-none"
        title="History"
        aria-label="History"
      >
        <History size={14} className="w-4 h-4 md:w-3.5 md:h-3.5" />
      </PopoverButton>
      <PopoverPanel transition anchor="bottom end" className={cn(PANEL_CLASS, "w-72 p-1.5 [--anchor-gap:4px]")}>
        {({ close }) => <RevisionList fs={fs} path={path} onPeek={onPeek} onPin={onPin} close={close} />}
      </PopoverPanel>
    </Popover>
  );
}

interface RevisionListProps extends ArtifactHistoryPopoverProps {
  close: () => void;
}

/** Mounted only while the popover is open, so loading happens per opening. */
function RevisionList({ fs, path, onPeek, onPin, close }: RevisionListProps) {
  const [entries, setEntries] = useState<ArtifactRevisionListing[] | null>(null);

  useEffect(() => {
    let version = 0;
    const load = async () => {
      const request = ++version;
      try {
        const listed = await fs.listRevisions(path);
        if (request === version) setEntries(listed);
      } catch (error) {
        console.error("Error loading artifact revisions:", error);
        if (request === version) setEntries([]);
      }
    };
    const refresh = (changed: string) => {
      if (changed === path) void load();
    };
    const subscriptions = [
      fs.subscribe("fileCreated", refresh),
      fs.subscribe("fileUpdated", refresh),
      fs.subscribe("fileRenamed", (from, to) => {
        if (from === path || to === path) void load();
      }),
    ];
    void load();
    return () => {
      version++;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, [fs, path]);

  // Leaving the popover (closing it) must not leave a hover preview behind.
  useEffect(() => () => onPeek(null), [onPeek]);

  if (entries === null) {
    return <div className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500">Loading…</div>;
  }
  if (entries.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500">No earlier revisions</div>
    );
  }

  return (
    <ul
      role="list"
      aria-label="Revisions"
      className="max-h-80 overflow-auto"
      onMouseLeave={() => onPeek(null)}
    >
      {entries.map((entry) => (
        <li key={`${entry.revision}-${entry.createdAt}`}>
          <button
            type="button"
            onMouseEnter={() => onPeek(entry)}
            onFocus={() => onPeek(entry)}
            onClick={() => {
              onPin(entry);
              close();
            }}
            className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-neutral-100/60 dark:hover:bg-white/5 focus-visible:bg-neutral-100/60 dark:focus-visible:bg-white/5 focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span
                  className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200"
                  title={formatAbsoluteTime(entry.createdAt)}
                >
                  {formatRelativeTime(entry.createdAt)}
                </span>
                {entry.current && (
                  <span className="shrink-0 rounded-full bg-neutral-200/70 dark:bg-neutral-700/70 px-1.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
                    Current
                  </span>
                )}
              </span>
              <span className="block truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                {revisionActorLabel(entry)}
              </span>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
              {formatBytes(entry.size)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
