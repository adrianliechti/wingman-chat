import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Folder, File, ChevronRight, Loader2, FolderOpen, Square, SquareCheckBig } from "lucide-react";
import { formatBytes, lookupContentType } from "@/shared/lib/utils";
import { listDriveEntries, getDriveInsights, type DriveEntry, type InsightCategory } from "@/shared/lib/drives";

interface DriveConfig {
  id: string;
  name: string;
  icon?: string;
}

export interface SelectedFile {
  name: string;
  path: string;
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

  // Check by file extension
  if (ext && filter.extensions.has(ext)) return true;

  // Resolve the file's MIME type: use entry.mime if available, otherwise infer from extension
  const mime = (entry.mime || (ext && lookupContentType(ext)) || "").toLowerCase();

  // Check against MIME patterns (exact or wildcard like "image/*")
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
  selected: Set<string>;
  onToggleSelect: (entry: DriveEntry) => void;
  acceptFilter: ReturnType<typeof parseAccept>;
}

function TreeItem({ entry, depth, driveId, selected, onToggleSelect, acceptFilter }: TreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DriveEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isDir = entry.kind === "directory";
  const isSelected = selected.has(entry.path);
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
        const entries = await listDriveEntries(driveId, entry.path);
        setChildren(sortEntries(entries));
      } catch (err) {
        console.error("Failed to list directory:", err);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }

    setExpanded(true);
  }, [isDir, expanded, children, driveId, entry.path]);

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 py-1.5 pr-2 rounded-md transition-colors ${
          isDisabled
            ? "opacity-40 cursor-default"
            : "hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40 cursor-pointer"
        }`}
        style={{ paddingLeft: `${depth * 16}px` }}
        onClick={() => {
          if (isDisabled) return;
          isDir ? handleExpand() : onToggleSelect(entry);
        }}
      >
        {/* Expand toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isDir) handleExpand();
          }}
          className={`p-0.5 rounded transition-transform ${isDir ? "cursor-pointer" : "invisible"}`}
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

        {/* Icon / Checkbox */}
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

        {/* Name */}
        <span className="ml-0.5 text-sm text-neutral-800 dark:text-neutral-200 truncate flex-1">{entry.name}</span>

        {/* Size */}
        {!isDir && entry.size != null && (
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap tabular-nums mr-1">
            {formatBytes(entry.size)}
          </span>
        )}
      </div>

      {/* Children */}
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
                key={child.path}
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
  const acceptFilter = useMemo(() => parseAccept(accept), [accept]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEntries, setSelectedEntries] = useState<Map<string, DriveEntry>>(new Map());
  const [insights, setInsights] = useState<InsightCategory[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDriveEntries(drive.id);
      setEntries(sortEntries(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [drive.id]);

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set());
      setSelectedEntries(new Map());
      setInsights([]);
      setActiveTab(null);
      loadRoot();
      setInsightsLoading(true);
      getDriveInsights(drive.id)
        .then(setInsights)
        .catch(() => {})
        .finally(() => setInsightsLoading(false));
    }
  }, [isOpen, loadRoot, drive.id]);

  const handleToggleSelect = useCallback((entry: DriveEntry) => {
    setSelected((prev) => {
      if (prev.has(entry.path)) {
        const next = new Set(prev);
        next.delete(entry.path);
        return next;
      }
      if (multiple) {
        return new Set([...prev, entry.path]);
      }
      return new Set([entry.path]);
    });

    setSelectedEntries((prev) => {
      if (prev.has(entry.path)) {
        const next = new Map(prev);
        next.delete(entry.path);
        return next;
      }
      if (multiple) {
        return new Map([...prev, [entry.path, entry]]);
      }
      return new Map([[entry.path, entry]]);
    });
  }, []);

  const handleAttach = useCallback(() => {
    const files: SelectedFile[] = Array.from(selectedEntries.values()).map((entry) => ({
      name: entry.name,
      path: entry.path,
      driveId: drive.id,
      mime: entry.mime,
    }));

    onFilesSelected(files);
    onClose();
  }, [selectedEntries, drive.id, onFilesSelected, onClose]);

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
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-200/60 dark:border-neutral-800/60 shrink-0">
                  <Dialog.Title className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 shrink-0">
                    {drive.name}
                  </Dialog.Title>

                  {/* Tabs */}
                  {(insights.length > 0 || insightsLoading) && (
                    <div className="flex items-center gap-0.5 overflow-x-auto">
                      <button
                        type="button"
                        className={`px-2 py-0.5 text-[11px] font-medium rounded whitespace-nowrap transition-colors ${
                          activeTab === null
                            ? "bg-neutral-200/80 dark:bg-neutral-700/80 text-neutral-900 dark:text-neutral-100"
                            : "text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
                        }`}
                        onClick={() => setActiveTab(null)}
                      >
                        Browse
                      </button>
                      {insightsLoading && (
                        <Loader2 size={10} className="animate-spin text-neutral-300 dark:text-neutral-600 mx-1" />
                      )}
                      {insights.map((cat) => (
                        <button
                          key={cat.label}
                          type="button"
                          className={`px-2 py-0.5 text-[11px] font-medium rounded whitespace-nowrap transition-colors ${
                            activeTab === cat.label
                              ? "bg-neutral-200/80 dark:bg-neutral-700/80 text-neutral-900 dark:text-neutral-100"
                              : "text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
                          }`}
                          onClick={() => setActiveTab(cat.label)}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto px-4 py-2.5 h-80">
                  {activeTab === null ? (
                    // Tree view
                    loading && entries.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-neutral-400">
                        <Loader2 size={16} className="animate-spin" />
                      </div>
                    ) : error ? (
                      <div className="flex items-center justify-center h-32 text-red-500 text-xs">{error}</div>
                    ) : entries.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-neutral-400 text-xs">No files</div>
                    ) : (
                      entries.map((entry) => (
                        <TreeItem
                          key={entry.path}
                          entry={entry}
                          depth={0}
                          driveId={drive.id}
                          selected={selected}
                          onToggleSelect={handleToggleSelect}
                          acceptFilter={acceptFilter}
                        />
                      ))
                    )
                  ) : (
                    // Insight list
                    (() => {
                      const cat = insights.find((c) => c.label === activeTab);
                      const items = cat?.entries ?? [];
                      if (items.length === 0) {
                        return <div className="flex items-center justify-center h-32 text-neutral-400 text-xs">No suggestions</div>;
                      }
                      return items.map((entry) => {
                        const isSelected = selected.has(entry.path);
                        const isDisabled = acceptFilter != null && !fileMatchesAccept(entry, acceptFilter);
                        return (
                          <div
                            key={entry.path}
                            className={`group flex items-center gap-1.5 py-1.5 px-2 rounded-md transition-colors ${
                              isDisabled
                                ? "opacity-40 cursor-default"
                                : "hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40 cursor-pointer"
                            }`}
                            onClick={() => !isDisabled && handleToggleSelect(entry)}
                          >
                            {isSelected ? (
                              <SquareCheckBig size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                            ) : isDisabled ? (
                              <File size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                            ) : (
                              <>
                                <File size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500 group-hover:hidden" />
                                <Square size={15} className="shrink-0 text-neutral-300 dark:text-neutral-600 hidden group-hover:block" />
                              </>
                            )}
                            <span className="ml-0.5 text-sm text-neutral-800 dark:text-neutral-200 truncate flex-1">{entry.name}</span>
                            {entry.size != null && entry.size > 0 && (
                              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap tabular-nums mr-1">
                                {formatBytes(entry.size)}
                              </span>
                            )}
                          </div>
                        );
                      });
                    })()
                  )}
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
