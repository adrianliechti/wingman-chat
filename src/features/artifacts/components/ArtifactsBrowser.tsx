import { Download, Edit2, Folder, FolderOpen, MoreVertical, PanelRightClose, Trash, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import type { DriveConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { notify } from "@/shared/lib/notify";
import type { FileEntry } from "@/shared/types/file";
import { DriveIcon } from "@/shared/ui/DriveIcon";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { FileIcon } from "@/shared/ui/FileIcon";

// Helper function to build folder tree structure
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
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

function buildFileTree(files: FileEntry[]): FileNode[] {
  const tree: FileNode[] = [];
  const folderMap = new Map<string, FileNode>();

  for (const file of files) {
    const pathParts = file.path.split("/").filter((part) => part.length > 0);
    let currentPath = "";
    let currentLevel = tree;

    // Build the folder chain leading to the file, reusing folders already created.
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentPath += `/${pathParts[i]}`;
      let folderNode = folderMap.get(currentPath);
      if (!folderNode) {
        folderNode = { name: pathParts[i], path: currentPath, type: "folder", children: [] };
        folderMap.set(currentPath, folderNode);
        currentLevel.push(folderNode);
      }
      currentLevel = folderNode.children ??= [];
    }

    currentLevel.push({ name: pathParts[pathParts.length - 1], path: file.path, type: "file", file });
  }

  // Sort once at the end rather than on every insert.
  sortTree(tree);
  return tree;
}

// Component to render individual file tree nodes
interface FileTreeNodeProps {
  node: FileNode;
  level: number;
  openTabs: string[];
  onFileClick: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile: (path: string) => void;
  onDownloadFile: (path: string) => void;
}

function FileTreeNode({
  node,
  level,
  openTabs,
  onFileClick,
  expandedFolders,
  onToggleFolder,
  onDeleteFile,
  onRenameFile,
  onDownloadFile,
}: FileTreeNodeProps) {
  const isExpanded = expandedFolders.has(node.path);

  if (node.type === "folder") {
    return (
      <>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 h-7 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer min-w-0"
          style={{ paddingLeft: `${level * 12 + 12}px` }}
          onClick={() => onToggleFolder(node.path)}
        >
          {isExpanded ? (
            <FolderOpen size={13} className="text-neutral-400 dark:text-neutral-500 shrink-0" />
          ) : (
            <Folder size={13} className="text-neutral-400 dark:text-neutral-500 shrink-0" />
          )}
          <span className="text-xs text-neutral-600 dark:text-neutral-400 truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && node.children.length > 0 && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                level={level + 1}
                openTabs={openTabs}
                onFileClick={onFileClick}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onDownloadFile={onDownloadFile}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  // File node
  const isTabOpen = openTabs.includes(node.path);

  return (
    <div
      className="flex items-center gap-1 h-7 pr-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors min-w-0 group relative"
      style={{ paddingLeft: `${level * 12 + 12}px` }}
    >
      <button
        type="button"
        onClick={() => onFileClick(node.path)}
        className="flex items-center gap-1 flex-1 min-w-0 text-left overflow-hidden"
      >
        <span className="shrink-0">
          <FileIcon name={node.path} contentType={node.file?.contentType} size={14} />
        </span>
        <span
          className={cn(
            "text-xs truncate",
            isTabOpen ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-700 dark:text-neutral-300",
          )}
          title={node.name}
        >
          {node.name}
        </span>
      </button>
      <DropdownMenu
        anchor="bottom end"
        trigger={
          <MenuButton
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1.5 rounded hover:bg-white/30 dark:hover:bg-black/20"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical size={14} />
          </MenuButton>
        }
      >
        <DropdownMenuItem icon={<Download size={12} />} onClick={() => onDownloadFile(node.path)}>
          Download
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Edit2 size={12} />} onClick={() => onRenameFile(node.path)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Trash size={12} />} destructive onClick={() => onDeleteFile(node.path)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}

interface ArtifactsBrowserProps {
  fs: FileSystemManager;
  files: FileEntry[];
  openTabs: string[];
  onFileClick: (path: string) => void;
  drives?: DriveConfig[];
  isProcessing?: boolean;
  onUploadLocal?: () => void;
  onUploadDrive?: (drive: DriveConfig) => void;
  onDownloadAll?: () => void;
  onDownloadFile?: (path: string) => void;
  onClose?: () => void;
}

export function ArtifactsBrowser({
  fs,
  files,
  openTabs,
  onFileClick,
  drives = [],
  isProcessing = false,
  onUploadLocal,
  onUploadDrive,
  onDownloadAll,
  onDownloadFile,
  onClose,
}: ArtifactsBrowserProps) {
  const hasDrives = drives.length > 0 && !!onUploadDrive;
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to filesystem events for folder expansion/collapse UI
  useEffect(() => {
    const unsubscribeCreated = fs.subscribe("fileCreated", (path: string) => {
      // Auto-expand parent folders when new files are created
      const pathParts = path.split("/").filter((part) => part.length > 0);
      setExpandedFolders((prev) => {
        const newExpanded = new Set(prev);
        let currentPath = "";

        // Expand all parent folders up to the file
        for (let i = 0; i < pathParts.length - 1; i++) {
          currentPath += `/${pathParts[i]}`;
          newExpanded.add(currentPath);
        }

        return newExpanded;
      });
    });

    const unsubscribeDeleted = fs.subscribe("fileDeleted", (path: string) => {
      // If a folder is deleted, remove it from expanded folders
      setExpandedFolders((prev) => {
        const newExpanded = new Set(prev);
        newExpanded.delete(path);

        // Also remove any nested expanded folders
        const expandedArray = Array.from(newExpanded);
        for (const expandedPath of expandedArray) {
          if (expandedPath.startsWith(`${path}/`)) {
            newExpanded.delete(expandedPath);
          }
        }

        return newExpanded;
      });
    });

    return () => {
      unsubscribeCreated();
      unsubscribeDeleted();
    };
  }, [fs]);

  // Build the file tree from files state
  const fileTree = buildFileTree(files);

  useEffect(() => {
    if (!renamingPath) return;

    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingPath]);

  const handleToggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  const handleDeleteFile = async (path: string) => {
    if (confirm(`Are you sure you want to delete "${path}"?`)) {
      await fs.deleteFile(path);
    }
  };

  const handleRenameFile = (path: string) => {
    const fileName = path.split("/").pop() || "";
    setRenamingPath(path);
    setRenameValue(fileName);
  };

  const handleRenameSubmit = async () => {
    if (!renamingPath || !renameValue.trim()) return;

    const pathParts = renamingPath.split("/");
    pathParts[pathParts.length - 1] = renameValue.trim();
    const newPath = pathParts.join("/");

    if (newPath !== renamingPath) {
      const success = await fs.renameFile(renamingPath, newPath);
      if (!success) {
        notify.error("Couldn't rename file", "A file with that name may already exist.");
      }
    }

    setRenamingPath(null);
    setRenameValue("");
  };

  const handleRenameCancel = () => {
    setRenamingPath(null);
    setRenameValue("");
  };

  // Upload + drive entries, shared by the header overflow menu and the bottom button.
  const uploadMenuItems = (disabled: boolean) => (
    <>
      {onUploadLocal && (
        <DropdownMenuItem icon={<Upload size={16} />} onClick={onUploadLocal} disabled={disabled}>
          Upload
        </DropdownMenuItem>
      )}
      {hasDrives &&
        drives.map((drive) => (
          <DropdownMenuItem
            key={drive.id}
            disabled={disabled}
            icon={<DriveIcon drive={drive} />}
            onClick={() => onUploadDrive?.(drive)}
          >
            {drive.name}
          </DropdownMenuItem>
        ))}
    </>
  );

  return (
    <div className="w-full h-full flex flex-col">
      {/* File list - grows to fill space */}
      <div className="flex-1 overflow-auto min-h-0">
        <div className="min-w-full">
          {/* Root folder row — height matches the editor top bar so the close
              button lines up with the open button it replaces. */}
          <div className="flex items-center gap-1 pl-1.5 pr-2 h-12 md:h-10 min-w-0 group">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title="Hide files"
                className="shrink-0 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5"
              >
                <PanelRightClose size={14} />
              </button>
            )}
            <div className="flex-1" />
            {(onUploadLocal || hasDrives || onDownloadAll) && (
              <DropdownMenu
                anchor="bottom start"
                trigger={
                  <MenuButton className="shrink-0 text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5">
                    <MoreVertical size={14} />
                  </MenuButton>
                }
              >
                {uploadMenuItems(isProcessing)}
                {onDownloadAll && files.length > 0 && (
                  <DropdownMenuItem icon={<Download size={16} />} onClick={onDownloadAll}>
                    Download all
                  </DropdownMenuItem>
                )}
              </DropdownMenu>
            )}
          </div>

          {/* Render file tree indented under root */}
          {fileTree.length > 0 && (
            <div className="py-1">
              {fileTree.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  level={0}
                  openTabs={openTabs}
                  onFileClick={onFileClick}
                  expandedFolders={expandedFolders}
                  onToggleFolder={handleToggleFolder}
                  onDeleteFile={handleDeleteFile}
                  onRenameFile={handleRenameFile}
                  onDownloadFile={onDownloadFile ?? (() => {})}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Upload + Download all */}
      {(onUploadLocal || hasDrives) && (
        <div className="@container shrink-0 px-3 py-2">
          {hasDrives ? (
            <DropdownMenu
              anchor="top start"
              trigger={
                <MenuButton
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors disabled:opacity-50"
                >
                  <Upload size={12} className="shrink-0" />
                  <span className="@max-[160px]:hidden">Upload files</span>
                </MenuButton>
              }
            >
              {uploadMenuItems(false)}
            </DropdownMenu>
          ) : (
            <button
              type="button"
              disabled={isProcessing}
              onClick={onUploadLocal}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors disabled:opacity-50"
            >
              <Upload size={12} className="shrink-0" />
              <span className="@max-[160px]:hidden">Upload files</span>
            </button>
          )}
        </div>
      )}

      {/* Rename Dialog */}
      {renamingPath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button
            type="button"
            aria-label="Close rename dialog"
            className="absolute inset-0 bg-black/50"
            onClick={handleRenameCancel}
          />
          <div className="relative bg-white dark:bg-neutral-900 rounded-lg shadow-xl p-4 w-80 max-w-[90vw]">
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">Rename File</h3>
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleRenameSubmit();
                } else if (e.key === "Escape") {
                  handleRenameCancel();
                }
              }}
              className="w-full px-3 py-2 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                onClick={handleRenameCancel}
                className="px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameSubmit}
                className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
