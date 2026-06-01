import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Download, Edit2, Folder, FolderOpen, HardDrive, MoreVertical, Trash, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import type { DriveConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import type { FileEntry } from "@/shared/types/file";
import { FileIcon } from "@/shared/ui/FileIcon";

// Helper function to build folder tree structure
interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  file?: FileEntry;
}

function buildFileTree(files: FileEntry[]): FileNode[] {
  const tree: FileNode[] = [];
  const folderMap = new Map<string, FileNode>();

  // Sort files by path to ensure consistent ordering
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const pathParts = file.path.split("/").filter((part: string) => part.length > 0);
    let currentPath = "";
    let currentLevel = tree;

    // Create folder structure
    for (let i = 0; i < pathParts.length - 1; i++) {
      const folderName = pathParts[i];
      currentPath += `/${folderName}`;

      let folderNode = folderMap.get(currentPath);
      if (!folderNode) {
        folderNode = {
          name: folderName,
          path: currentPath,
          type: "folder",
          children: [],
        };
        folderMap.set(currentPath, folderNode);
        currentLevel.push(folderNode);

        // Sort folders before files
        currentLevel.sort((a, b) => {
          if (a.type === "folder" && b.type === "file") return -1;
          if (a.type === "file" && b.type === "folder") return 1;
          return a.name.localeCompare(b.name);
        });
      }

      const folderChildren = folderNode.children ?? [];
      folderNode.children = folderChildren;
      currentLevel = folderChildren;
    }

    // Add the file
    const fileName = pathParts[pathParts.length - 1];
    currentLevel.push({
      name: fileName,
      path: file.path,
      type: "file",
      file: file,
    });

    // Sort the current level again
    currentLevel.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      return a.name.localeCompare(b.name);
    });
  }

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
      <Menu>
        <MenuButton
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1.5 rounded hover:bg-white/30 dark:hover:bg-black/20"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical size={14} />
        </MenuButton>
        <MenuItems
          modal={false}
          transition
          anchor="bottom end"
          className="w-32 origin-top-right rounded-md border border-white/20 dark:border-white/15 bg-white/90 dark:bg-black/90 backdrop-blur-lg shadow-lg transition duration-100 ease-out [--anchor-gap:var(--spacing-1)] data-closed:scale-95 data-closed:opacity-0 z-50"
        >
          <MenuItem>
            <button
              type="button"
              onClick={() => onDownloadFile(node.path)}
              className="group flex w-full items-center gap-1.5 rounded-md py-1.5 px-2.5 text-xs data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              <Download size={12} />
              Download
            </button>
          </MenuItem>
          <MenuItem>
            <button
              type="button"
              onClick={() => onRenameFile(node.path)}
              className="group flex w-full items-center gap-1.5 rounded-md py-1.5 px-2.5 text-xs data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              <Edit2 size={12} />
              Rename
            </button>
          </MenuItem>
          <MenuItem>
            <button
              type="button"
              onClick={() => onDeleteFile(node.path)}
              className="group flex w-full items-center gap-1.5 rounded-md py-1.5 px-2.5 text-xs data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
            >
              <Trash size={12} />
              Delete
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
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
        alert("Failed to rename file. A file with that name may already exist.");
      }
    }

    setRenamingPath(null);
    setRenameValue("");
  };

  const handleRenameCancel = () => {
    setRenamingPath(null);
    setRenameValue("");
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* File list - grows to fill space */}
      <div className="flex-1 overflow-auto min-h-0">
        <div className="pt-1 min-w-full">
          {/* Root folder row */}
          <div className="flex items-center gap-1 pl-3 pr-2 py-2 min-w-0 group">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 truncate flex-1">
              Files
            </span>
            {(onUploadLocal || hasDrives || onDownloadAll) && (
              <Menu>
                <MenuButton className="shrink-0 text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5">
                  <MoreVertical size={14} />
                </MenuButton>
                <MenuItems
                  modal={false}
                  transition
                  anchor="bottom start"
                  className="mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 overflow-hidden shadow-2xl shadow-black/40 dark:shadow-black/80 z-50 min-w-48 dark:ring-1 dark:ring-white/10"
                >
                  {onUploadLocal && (
                    <MenuItem>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={onUploadLocal}
                        className="group flex w-full items-center gap-3 px-4 py-2.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-b border-white/20 dark:border-white/10 disabled:opacity-50"
                      >
                        <Upload size={16} />
                        <span className="font-medium text-sm">Upload</span>
                      </button>
                    </MenuItem>
                  )}
                  {hasDrives &&
                    drives.map((drive) => (
                      <MenuItem key={drive.id}>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => onUploadDrive?.(drive)}
                          className="group flex w-full items-center gap-3 px-4 py-2.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-b border-white/20 dark:border-white/10 last:border-b-0 disabled:opacity-50"
                        >
                          {drive.icon ? (
                            <span
                              className="shrink-0 bg-current inline-block"
                              style={{
                                width: 16,
                                height: 16,
                                maskImage: `url(${drive.icon})`,
                                WebkitMaskImage: `url(${drive.icon})`,
                                maskSize: "contain",
                                maskRepeat: "no-repeat",
                                maskPosition: "center",
                              }}
                            />
                          ) : (
                            <HardDrive size={16} />
                          )}
                          <span className="font-medium text-sm truncate">{drive.name}</span>
                        </button>
                      </MenuItem>
                    ))}
                  {onDownloadAll && files.length > 0 && (
                    <MenuItem>
                      <button
                        type="button"
                        onClick={onDownloadAll}
                        className="group flex w-full items-center gap-3 px-4 py-2.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-t border-white/20 dark:border-white/10"
                      >
                        <Download size={16} />
                        <span className="font-medium text-sm">Download all</span>
                      </button>
                    </MenuItem>
                  )}
                </MenuItems>
              </Menu>
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
            <Menu>
              <MenuButton
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors disabled:opacity-50"
              >
                <Upload size={12} className="shrink-0" />
                <span className="@max-[160px]:hidden">Upload files</span>
              </MenuButton>
              <MenuItems
                modal={false}
                transition
                anchor="top start"
                className="mb-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 overflow-hidden shadow-2xl shadow-black/40 dark:shadow-black/80 z-50 min-w-48 dark:ring-1 dark:ring-white/10"
              >
                {onUploadLocal && (
                  <MenuItem>
                    <button
                      type="button"
                      onClick={onUploadLocal}
                      className="group flex w-full items-center gap-3 px-4 py-2.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-b border-white/20 dark:border-white/10"
                    >
                      <Upload size={16} className="shrink-0" />
                      <span className="font-medium text-sm truncate">Upload</span>
                    </button>
                  </MenuItem>
                )}
                {drives.map((drive) => (
                  <MenuItem key={drive.id}>
                    <button
                      type="button"
                      onClick={() => onUploadDrive?.(drive)}
                      className="group flex w-full items-center gap-3 px-4 py-2.5 data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 hover:bg-neutral-100/40 dark:hover:bg-white/3 text-neutral-800 dark:text-neutral-200 transition-colors border-b border-white/20 dark:border-white/10 last:border-b-0"
                    >
                      {drive.icon ? (
                        <span
                          className="shrink-0 bg-current inline-block"
                          style={{
                            width: 16,
                            height: 16,
                            maskImage: `url(${drive.icon})`,
                            WebkitMaskImage: `url(${drive.icon})`,
                            maskSize: "contain",
                            maskRepeat: "no-repeat",
                            maskPosition: "center",
                          }}
                        />
                      ) : (
                        <HardDrive size={16} />
                      )}
                      <span className="font-medium text-sm truncate">{drive.name}</span>
                    </button>
                  </MenuItem>
                ))}
              </MenuItems>
            </Menu>
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
                  handleRenameSubmit();
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
