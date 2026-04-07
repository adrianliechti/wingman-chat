import { useState, useEffect, useCallback, Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Folder, File, ChevronRight, Loader2, FolderOpen, Check } from "lucide-react";
import { formatBytes } from "@/shared/lib/utils";
import { listDriveEntries, type DriveEntry } from "@/shared/lib/drives";

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
}

interface TreeItemProps {
  entry: DriveEntry;
  depth: number;
  driveId: string;
  selected: Set<string>;
  onToggleSelect: (entry: DriveEntry) => void;
}

function TreeItem({ entry, depth, driveId, selected, onToggleSelect }: TreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DriveEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isDir = entry.kind === "directory";
  const isSelected = selected.has(entry.path);

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
        setChildren(entries);
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
        className="group flex items-center gap-1 py-1 pr-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 rounded-md transition-colors cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => (isDir ? handleExpand() : onToggleSelect(entry))}
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

        {/* Icon */}
        {isDir ? (
          <Folder size={15} className="shrink-0 text-amber-500 dark:text-amber-400" />
        ) : (
          <File size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
        )}

        {/* Name */}
        <span className="ml-1 text-sm text-neutral-800 dark:text-neutral-200 truncate flex-1">{entry.name}</span>

        {/* Size */}
        {!isDir && entry.size != null && (
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap tabular-nums mr-1">
            {formatBytes(entry.size)}
          </span>
        )}

        {/* Checkbox for files */}
        {!isDir && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(entry);
            }}
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              isSelected
                ? "bg-blue-500 border-blue-500 text-white"
                : "border-neutral-300 dark:border-neutral-600 hover:border-blue-400"
            }`}
          >
            {isSelected && <Check size={12} strokeWidth={3} />}
          </button>
        )}
      </div>

      {/* Children */}
      {isDir && expanded && children && (
        <div>
          {children.length === 0 ? (
            <div
              className="text-xs text-neutral-400 dark:text-neutral-500 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}
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
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function DrivePicker({ isOpen, onClose, drive, onFilesSelected }: DrivePickerProps) {
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEntries, setSelectedEntries] = useState<Map<string, DriveEntry>>(new Map());

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDriveEntries(drive.id);
      setEntries(result);
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
      loadRoot();
    }
  }, [isOpen, loadRoot]);

  const handleToggleSelect = useCallback((entry: DriveEntry) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      return next;
    });

    setSelectedEntries((prev) => {
      const next = new Map(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.set(entry.path, entry);
      }
      return next;
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
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 shadow-xl transition-all flex flex-col max-h-[80vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <FolderOpen size={18} className="text-neutral-500 dark:text-neutral-400" />
                    <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                      {drive.name}
                    </Dialog.Title>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Tree content */}
                <div className="flex-1 overflow-y-auto px-4 py-3 min-h-50">
                  {loading && entries.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-neutral-400">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  ) : error ? (
                    <div className="flex items-center justify-center h-32 text-red-500 text-sm">{error}</div>
                  ) : entries.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-neutral-400 text-sm">No files</div>
                  ) : (
                    entries.map((entry) => (
                      <TreeItem
                        key={entry.path}
                        entry={entry}
                        depth={0}
                        driveId={drive.id}
                        selected={selected}
                        onToggleSelect={handleToggleSelect}
                      />
                    ))
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-3 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 shrink-0">
                  <span className="text-xs text-neutral-500">
                    {selected.size > 0 ? `${selected.size} file${selected.size === 1 ? "" : "s"} selected` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 text-sm font-medium rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAttach}
                      disabled={selected.size === 0}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
