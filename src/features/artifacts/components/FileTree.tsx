import { Download, Edit2, Folder, FolderOpen, MoreVertical, Trash } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import type { FileEntry } from "@/shared/types/file";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { FileIcon } from "@/shared/ui/FileIcon";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  file?: FileEntry;
}

// Folders before files, then alphabetical by name.
function compareNodes(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function sortTree(nodes: FileNode[]): void {
  nodes.sort(compareNodes);
  for (const node of nodes) if (node.children) sortTree(node.children);
}

function buildFileTree(files: FileEntry[]): FileNode[] {
  const tree: FileNode[] = [];
  const folders = new Map<string, FileNode>();
  for (const file of files) {
    const parts = file.path.split("/").filter((part) => part.length > 0);
    let current = "";
    let level = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      current += `/${parts[i]}`;
      let folder = folders.get(current);
      if (!folder) {
        folder = { name: parts[i], path: current, type: "folder", children: [] };
        folders.set(current, folder);
        level.push(folder);
      }
      level = folder.children ??= [];
    }
    level.push({ name: parts[parts.length - 1], path: file.path, type: "file", file });
  }
  sortTree(tree);
  return tree;
}

/** Folder paths leading to `path`, outermost first. */
function ancestors(path: string): string[] {
  const parts = path.split("/").filter((part) => part.length > 0);
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < parts.length - 1; i++) {
    current += `/${parts[i]}`;
    out.push(current);
  }
  return out;
}

const rowClass = "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-1 text-left transition-colors";
const hoverClass = "hover:bg-neutral-200/40 dark:hover:bg-white/5";

interface FileTreeProps {
  fs: FileSystemManager;
  files: FileEntry[];
  activePath: string | null;
  onOpen: (path: string) => void;
  onDownload?: (path: string) => void;
  /** Substring filter on the path; matches are shown with their folders expanded. */
  filter?: string;
  /** Show every folder open, for a quick-switch list where one click should reach any file. */
  expandAll?: boolean;
  className?: string;
}

/**
 * Folder tree over the artifact files with the same row treatment as the chat
 * sidebar: rounded selection, hover fill, and a per-row menu. Folders on the way
 * to the active file (or to a newly created one) open by themselves; renaming
 * happens inline in the row.
 */
export function FileTree({
  fs,
  files,
  activePath,
  onOpen,
  onDownload,
  filter = "",
  expandAll = false,
  className,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activePath ? ancestors(activePath) : []));
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activePath) return;
    setExpanded((prev) => new Set([...prev, ...ancestors(activePath)]));
  }, [activePath]);

  useEffect(() => {
    const created = fs.subscribe("fileCreated", (path: string) => {
      setExpanded((prev) => new Set([...prev, ...ancestors(path)]));
    });
    const deleted = fs.subscribe("fileDeleted", (path: string) => {
      setExpanded((prev) => new Set([...prev].filter((p) => p !== path && !p.startsWith(`${path}/`))));
    });
    return () => {
      created();
      deleted();
    };
  }, [fs]);

  useEffect(() => {
    if (!renaming) return;
    renameRef.current?.focus();
    renameRef.current?.select();
  }, [renaming?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = filter.trim().toLowerCase();
  const tree = useMemo(
    () => buildFileTree(query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files),
    [files, query],
  );

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const remove = async (path: string) => {
    const ok = await confirm({
      title: "Delete file?",
      message: `"${path.replace(/^\//, "")}" will be permanently removed.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await fs.deleteFile(path);
  };

  const submitRename = async () => {
    if (!renaming) return;
    const name = renaming.value.trim();
    const target = renaming.path.slice(0, renaming.path.lastIndexOf("/") + 1) + name;
    setRenaming(null);
    if (!name || target === renaming.path) return;
    if (!(await fs.renameFile(renaming.path, target)))
      notify.error("Couldn't rename file", "A file with that name may already exist.");
  };

  const renderNode = (node: FileNode, level: number) => {
    const indent = { paddingLeft: `${level * 12 + 8}px` };
    if (node.type === "folder") {
      const open = expandAll || query.length > 0 || expanded.has(node.path);
      return (
        <div key={node.path}>
          <button
            type="button"
            onClick={() => toggle(node.path)}
            className={cn(rowClass, hoverClass, "text-neutral-600 dark:text-neutral-400")}
            style={indent}
          >
            {open ? (
              <FolderOpen size={13} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
            ) : (
              <Folder size={13} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
            )}
            <span className="truncate text-xs">{node.name}</span>
          </button>
          {open && node.children?.map((child) => renderNode(child, level + 1))}
        </div>
      );
    }
    const active = node.path === activePath;
    return (
      <div
        key={node.path}
        className={cn(
          "group relative flex h-7 min-w-0 items-center gap-1 rounded-md pr-1 transition-colors",
          active ? "bg-neutral-200/70 dark:bg-white/10" : hoverClass,
        )}
        style={indent}
      >
        {renaming?.path === node.path ? (
          <input
            ref={renameRef}
            type="text"
            value={renaming.value}
            aria-label={`Rename ${node.name}`}
            onChange={(event) => setRenaming({ path: node.path, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitRename();
              if (event.key === "Escape") setRenaming(null);
            }}
            onBlur={() => void submitRename()}
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1 text-xs text-neutral-800 outline-none focus:border-neutral-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:focus:border-neutral-400"
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpen(node.path)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title={node.path}
          >
            <FileIcon name={node.path} contentType={node.file?.contentType} size={14} />
            <span
              className={cn(
                "truncate text-xs",
                active
                  ? "font-medium text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-700 dark:text-neutral-300",
              )}
            >
              {node.name}
            </span>
          </button>
        )}
        <DropdownMenu
          anchor="bottom end"
          trigger={
            <MenuButton
              className="shrink-0 rounded p-1 text-neutral-400 transition-opacity hover:text-neutral-700 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:hover:text-neutral-200"
              aria-label={`Actions for ${node.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreVertical size={13} />
            </MenuButton>
          }
        >
          {onDownload && (
            <DropdownMenuItem icon={<Download size={12} />} onClick={() => onDownload(node.path)}>
              Download
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            icon={<Edit2 size={12} />}
            onClick={() => setRenaming({ path: node.path, value: node.name })}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Trash size={12} />} destructive onClick={() => void remove(node.path)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <div className={className}>
      {tree.length === 0 ? (
        <p className="px-2 py-3 text-xs text-neutral-400 dark:text-neutral-500">
          {query ? "No files match." : "No files yet."}
        </p>
      ) : (
        tree.map((node) => renderNode(node, 0))
      )}
    </div>
  );
}
