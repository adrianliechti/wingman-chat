import { useState, useEffect, useCallback, Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Folder, File, ChevronRight, Trash2, RefreshCw, Loader2, HardDrive } from "lucide-react";
import { getRoot, deleteFile, deleteDirectory } from "@/shared/lib/opfs";
import { formatBytes } from "@/shared/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  children?: TreeNode[];
}

interface OpfsBrowserProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Tree building ──────────────────────────────────────────────────────────────

async function buildTree(handle: FileSystemDirectoryHandle, path: string): Promise<TreeNode[]> {
  const nodes: TreeNode[] = [];

  for await (const [name, entryHandle] of handle.entries()) {
    const entryPath = path ? `${path}/${name}` : name;

    if (entryHandle.kind === "file") {
      const fileHandle = entryHandle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      nodes.push({ name, path: entryPath, kind: "file", size: file.size });
    } else {
      const dirHandle = entryHandle as FileSystemDirectoryHandle;
      const children = await buildTree(dirHandle, entryPath);
      nodes.push({ name, path: entryPath, kind: "directory", children });
    }
  }

  // Sort: directories first, then alphabetical
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

function countDescendants(node: TreeNode): { files: number; size: number } {
  if (node.kind === "file") return { files: 1, size: node.size ?? 0 };
  let files = 0;
  let size = 0;
  for (const child of node.children ?? []) {
    const r = countDescendants(child);
    files += r.files;
    size += r.size;
  }
  return { files, size };
}

// ── Tree node component ────────────────────────────────────────────────────────

function TreeItem({ node, depth, onDelete }: { node: TreeNode; depth: number; onDelete: (node: TreeNode) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isDir = node.kind === "directory";
  const hasChildren = isDir && (node.children?.length ?? 0) > 0;

  const stats = isDir ? countDescendants(node) : null;

  return (
    <div>
      {/* Row */}
      <div
        className="group flex items-center gap-1 py-1 pr-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 rounded-md transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => isDir && setExpanded(!expanded)}
          className={`p-0.5 rounded transition-transform ${isDir ? "cursor-pointer" : "invisible"}`}
        >
          <ChevronRight
            size={14}
            className={`text-neutral-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
        </button>

        {/* Icon */}
        {isDir ? (
          <Folder size={15} className="shrink-0 text-amber-500 dark:text-amber-400" />
        ) : (
          <File size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
        )}

        {/* Name */}
        <span className="ml-1 text-sm text-neutral-800 dark:text-neutral-200 truncate select-text flex-1">
          {node.name}
        </span>

        {/* Meta */}
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap tabular-nums mr-1">
          {isDir
            ? `${stats?.files ?? 0} file${stats?.files === 1 ? "" : "s"} · ${formatBytes(stats?.size ?? 0)}`
            : formatBytes(node.size ?? 0)}
        </span>

        {/* Delete */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node);
          }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
          title={`Delete ${node.name}`}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Children */}
      {isDir && expanded && hasChildren && (
        <div>
          {(node.children ?? []).map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function OpfsBrowser({ isOpen, onClose }: OpfsBrowserProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalSize, setTotalSize] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const root = await getRoot();
      const nodes = await buildTree(root, "");
      setTree(nodes);

      // Calculate totals
      let size = 0;
      let files = 0;
      const walk = (n: TreeNode) => {
        if (n.kind === "file") {
          files++;
          size += n.size ?? 0;
        }
        n.children?.forEach(walk);
      };
      nodes.forEach(walk);
      setTotalSize(size);
      setTotalFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read OPFS");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadTree();
  }, [isOpen, loadTree]);

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      const label = node.kind === "directory" ? "directory" : "file";
      if (!window.confirm(`Delete ${label} "${node.path}"? This cannot be undone.`)) return;

      try {
        if (node.kind === "directory") {
          await deleteDirectory(node.path);
        } else {
          await deleteFile(node.path);
        }
        // Reload tree
        await loadTree();
      } catch (err) {
        console.error("Failed to delete:", err);
        alert(`Failed to delete ${node.path}`);
      }
    },
    [loadTree],
  );

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
                    <HardDrive size={18} className="text-neutral-500 dark:text-neutral-400" />
                    <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                      OPFS Browser
                    </Dialog.Title>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={loadTree}
                      disabled={loading}
                      className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
                      title="Refresh"
                    >
                      <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* Summary bar */}
                <div className="px-6 py-2 border-b border-neutral-100 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/50 text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-3 shrink-0">
                  <span>
                    {totalFiles} file{totalFiles === 1 ? "" : "s"}
                  </span>
                  <span>·</span>
                  <span>{formatBytes(totalSize)}</span>
                </div>

                {/* Tree content */}
                <div className="flex-1 overflow-y-auto px-4 py-3 min-h-50">
                  {loading && tree.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-neutral-400">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  ) : error ? (
                    <div className="flex items-center justify-center h-32 text-red-500 text-sm">{error}</div>
                  ) : tree.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-neutral-400 text-sm">OPFS is empty</div>
                  ) : (
                    tree.map((node) => <TreeItem key={node.path} node={node} depth={0} onDelete={handleDelete} />)
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end px-6 py-3 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 shrink-0">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
