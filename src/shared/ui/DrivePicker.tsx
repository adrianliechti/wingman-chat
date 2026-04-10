import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Folder, File, ChevronRight, Loader2, FolderOpen, Square, SquareCheckBig } from "lucide-react";
import { formatBytes, lookupContentType } from "@/shared/lib/utils";
import { listDriveEntries, type DriveEntry } from "@/shared/lib/drives";

interface DriveConfig {
  id: string;
  name: string;
}

export interface SelectedFile {
  id: string;
  name: string;
  driveId: string;
  mime?: string;
}

interface DrivePickerProps {
  isOpen: boolean;
  onClose: () => void;
  drive: DriveConfig;
  onFilesSelected: (files: SelectedFile[]) => void;
  /** Comma-separated accept string like native file input, e.g. ".pdf,.docx,image/*" */
  accept?: string;
  /** Allow selecting multiple files (default: false, like native file input) */
  multiple?: boolean;
}

function parseAccept(accept?: string): { extensions: Set<string>; mimePatterns: string[] } | null {
  if (!accept) return null;
  const extensions = new Set<string>();
  const mimePatterns: string[] = [];
  for (const token of accept.split(",")) {
    const t = token.trim().toLowerCase();
    if (!t) continue;
    if (t.startsWith(".")) {
      extensions.add(t);
    } else {
      mimePatterns.push(t);
    }
  }
  if (extensions.size === 0 && mimePatterns.length === 0) return null;
  return { extensions, mimePatterns };
}

function fileMatchesAccept(entry: DriveEntry, filter: { extensions: Set<string>; mimePatterns: string[] }): boolean {
  const dotIdx = entry.name.lastIndexOf(".");
  const ext = dotIdx >= 0 ? entry.name.slice(dotIdx).toLowerCase() : "";

  if (ext && filter.extensions.has(ext)) return true;

  const mime = (entry.mime || (ext && lookupContentType(ext)) || "").toLowerCase();

  if (mime) {
    for (const pattern of filter.mimePatterns) {
      if (pattern === mime) return true;
      if (pattern.endsWith("/*") && mime.startsWith(pattern.slice(0, -1))) return true;
    }
  }

  return false;
}

function sortEntries(entries: DriveEntry[]): DriveEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

interface TreeItemProps {
  entry: DriveEntry;
  depth: number;
  driveId: string;
  selected: Map<string, DriveEntry>;
  onToggleSelect: (entry: DriveEntry) => void;
  acceptFilter: ReturnType<typeof parseAccept>;
}

function TreeItem({ entry, depth, driveId, selected, onToggleSelect, acceptFilter }: TreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DriveEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isDir = entry.kind === "directory";
  const isSelected = selected.has(entry.id);
  const isDisabled = !isDir && acceptFilter != null && !fileMatchesAccept(entry, acceptFilter);

  const handleExpand = useCallback(async () => {
    if (!isDir) return;

    if (expanded) {
      setExpanded(false);
      return;
    }

    if (children === null) {
      setLoading(true);
      try {
        const entries = await listDriveEntries(driveId, entry.id);
        setChildren(sortEntries(entries));
      } catch (err) {
        console.error("Failed to list directory:", err);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }

    setExpanded(true);
  }, [isDir, expanded, children, driveId, entry.id]);

  return (
    <div>
      <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 16}px` }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isDir) handleExpand();
          }}
          className={`p-0.5 rounded transition-transform ${isDir ? "cursor-pointer" : "invisible"}`}
          aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin text-neutral-400" />
          ) : (
            <ChevronRight
              size={14}
              className={`text-neutral-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            />
          )}
        </button>

        <button
          type="button"
          className={`group flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 rounded-md text-left transition-colors ${
            isDisabled
              ? "opacity-40 cursor-default"
              : "hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40 cursor-pointer"
          }`}
          disabled={isDisabled}
          onClick={() => {
            if (isDisabled) return;
            isDir ? handleExpand() : onToggleSelect(entry);
          }}
        >
          {isDir ? (
            expanded ? (
              <FolderOpen size={15} className="shrink-0 text-amber-500 dark:text-amber-400" />
            ) : (
              <Folder size={15} className="shrink-0 text-amber-500 dark:text-amber-400" />
            )
          ) : isSelected ? (
            <SquareCheckBig size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : isDisabled ? (
            <File size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
          ) : (
            <>
              <File size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500 group-hover:hidden" />
              <Square size={15} className="shrink-0 text-neutral-300 dark:text-neutral-600 hidden group-hover:block" />
            </>
          )}

          <span className="ml-0.5 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200">{entry.name}</span>

          {!isDir && entry.size != null && entry.size > 0 && (
            <span className="mr-1 whitespace-nowrap text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
              {formatBytes(entry.size)}
            </span>
          )}
        </button>
      </div>

      {isDir && expanded && children && (
        <div>
          {children.length === 0 ? (
            <div
              className="text-xs text-neutral-400 dark:text-neutral-500 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 20}px` }}
            >
              Empty
            </div>
          ) : (
            children.map((child) => (
              <TreeItem
                key={child.id}
                entry={child}
                depth={depth + 1}
                driveId={driveId}
                selected={selected}
                onToggleSelect={onToggleSelect}
                acceptFilter={acceptFilter}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function DrivePicker({ isOpen, onClose, drive, onFilesSelected, accept, multiple = false }: DrivePickerProps) {
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, DriveEntry>>(new Map());
  const acceptFilter = useMemo(() => parseAccept(accept), [accept]);
  const contentRef = useRef<HTMLDivElement>(null);
  const staleRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;

    const generation = ++staleRef.current;

    setEntries([]);
    setLoading(true);
    setError(null);
    setSelected(new Map());

    listDriveEntries(drive.id)
      .then((result) => {
        if (staleRef.current !== generation) return;
        setEntries(sortEntries(result));
      })
      .catch((err) => {
        if (staleRef.current !== generation) return;
        setError(err instanceof Error ? err.message : "Failed to load files");
      })
      .finally(() => {
        if (staleRef.current !== generation) return;
        setLoading(false);
      });

    return () => {
      staleRef.current++;
    };
  }, [isOpen, drive.id]);

  const handleToggleSelect = useCallback(
    (entry: DriveEntry) => {
      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(entry.id)) {
          next.delete(entry.id);
        } else if (multiple) {
          next.set(entry.id, entry);
        } else {
          return new Map([[entry.id, entry]]);
        }
        return next;
      });
    },
    [multiple],
  );

  const handleAttach = useCallback(() => {
    const files: SelectedFile[] = Array.from(selected.values()).map((entry) => ({
      id: entry.id,
      name: entry.name,
      driveId: drive.id,
      mime: entry.mime,
    }));

    onFilesSelected(files);
    onClose();
  }, [selected, drive.id, onFilesSelected, onClose]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-80" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl border border-neutral-200/50 dark:border-neutral-700/50 transition-all flex flex-col max-h-[80vh]">
                {/* Header */}
                <div className="border-b border-neutral-200/60 px-4 py-2.5 dark:border-neutral-800/60 shrink-0">
                  <div className="flex items-center gap-3">
                    <Dialog.Title className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      {drive.name}
                    </Dialog.Title>

                    <button
                      type="button"
                      onClick={onClose}
                      className="shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div ref={contentRef} className="overflow-y-auto px-4 py-2.5 h-80">
                  {loading && (
                    <div className="flex items-center justify-center h-32 text-neutral-400">
                      <Loader2 size={16} className="animate-spin" />
                    </div>
                  )}

                  {error && <div className="flex items-center justify-center h-32 text-red-500 text-xs">{error}</div>}

                  {!loading && !error && entries.length === 0 && (
                    <div className="flex items-center justify-center h-32 text-neutral-400 text-xs">No files</div>
                  )}

                  {!loading &&
                    !error &&
                    entries.map((entry) => (
                      <TreeItem
                        key={entry.id}
                        entry={entry}
                        depth={0}
                        driveId={drive.id}
                        selected={selected}
                        onToggleSelect={handleToggleSelect}
                        acceptFilter={acceptFilter}
                      />
                    ))}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30 rounded-b-xl shrink-0">
                  <span className="text-[11px] text-neutral-500">
                    {selected.size > 0 ? `${selected.size} file${selected.size === 1 ? "" : "s"} selected` : ""}
                  </span>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAttach}
                      disabled={selected.size === 0}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Attach{selected.size > 0 ? ` (${selected.size})` : ""}
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
