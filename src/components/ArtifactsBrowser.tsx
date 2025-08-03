import { useState } from 'react';
import { Edit3, Trash2, File, Folder, FolderOpen, ChevronRight, ChevronDown, Check, X, Download } from 'lucide-react';
import { Button } from '@headlessui/react';
import { FileIcon } from './FileIcon';
import { getFileName } from '../lib/utils';
import { FileSystemManager } from '../lib/fs';

// Helper function to build folder tree structure
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  file?: { path: string; content: string }; // Reference to the actual file object
}

function buildFileTree(files: { path: string; content: string }[]): FileNode[] {
  const tree: FileNode[] = [];
  const folderMap = new Map<string, FileNode>();

  // Sort files by path to ensure consistent ordering
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const pathParts = file.path.split('/').filter((part: string) => part.length > 0);
    let currentPath = '';
    let currentLevel = tree;

    // Create folder structure
    for (let i = 0; i < pathParts.length - 1; i++) {
      const folderName = pathParts[i];
      currentPath += '/' + folderName;
      
      let folderNode = folderMap.get(currentPath);
      if (!folderNode) {
        folderNode = {
          name: folderName,
          path: currentPath,
          type: 'folder',
          children: []
        };
        folderMap.set(currentPath, folderNode);
        currentLevel.push(folderNode);
        
        // Sort folders before files
        currentLevel.sort((a, b) => {
          if (a.type === 'folder' && b.type === 'file') return -1;
          if (a.type === 'file' && b.type === 'folder') return 1;
          return a.name.localeCompare(b.name);
        });
      }
      
      currentLevel = folderNode.children!;
    }

    // Add the file
    const fileName = pathParts[pathParts.length - 1];
    currentLevel.push({
      name: fileName,
      path: file.path,
      type: 'file',
      file: file
    });

    // Sort the current level again
    currentLevel.sort((a, b) => {
      if (a.type === 'folder' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'folder') return 1;
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
  onDeleteFile: (path: string, event: React.MouseEvent) => void;
  onDeleteFolder: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  renamingFile: string | null;
  onStartRename: (path: string) => void;
  onCancelRename: () => void;
}

function FileTreeNode({ 
  node, 
  level, 
  openTabs, 
  onFileClick, 
  onDeleteFile, 
  onDeleteFolder,
  onRenameFile,
  expandedFolders, 
  onToggleFolder,
  renamingFile,
  onStartRename,
  onCancelRename
}: FileTreeNodeProps) {
  const [renamingValue, setRenamingValue] = useState('');
  const isExpanded = expandedFolders.has(node.path);
  const isBeingRenamed = renamingFile === node.path;

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    
    if (e.key === 'Enter') {
      e.preventDefault();
      if (renamingValue.trim() && renamingValue !== node.name) {
        const pathParts = node.path.split('/');
        pathParts[pathParts.length - 1] = renamingValue.trim();
        const newPath = pathParts.join('/');
        onRenameFile(node.path, newPath);
      }
      onCancelRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancelRename();
    }
  };

  const startRename = () => {
    setRenamingValue(node.name);
    onStartRename(node.path);
  };

  const saveRename = () => {
    if (renamingValue.trim() && renamingValue !== node.name) {
      const pathParts = node.path.split('/');
      pathParts[pathParts.length - 1] = renamingValue.trim();
      const newPath = pathParts.join('/');
      onRenameFile(node.path, newPath);
    }
    onCancelRename();
  };

  if (node.type === 'folder') {
    return (
      <>
        <div
          className={`group flex items-center gap-2 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-md transition-colors`}
          style={{ marginLeft: `${level * 12}px` }}
        >
          {isBeingRenamed ? (
            <div className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-1">
                {isExpanded ? (
                  <ChevronDown size={14} className="text-neutral-500" />
                ) : (
                  <ChevronRight size={14} className="text-neutral-500" />
                )}
                {isExpanded ? (
                  <FolderOpen size={16} className="text-blue-600 dark:text-blue-400" />
                ) : (
                  <Folder size={16} className="text-blue-600 dark:text-blue-400" />
                )}
              </div>
              <input
                type="text"
                value={renamingValue}
                onChange={(e) => setRenamingValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                autoFocus
                className="flex-1 max-w-28 text-sm bg-white dark:bg-neutral-700 border border-slate-500 rounded px-2 py-1 text-neutral-900 dark:text-neutral-100 focus:ring-1 focus:ring-slate-500"
                onClick={(e) => e.stopPropagation()}
              />
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  saveRename();
                }}
                className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors"
                title="Save"
              >
                <Check size={12} />
              </Button>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelRename();
                }}
                className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors"
                title="Cancel"
              >
                <X size={12} />
              </Button>
            </div>
          ) : (
            <>
              <div 
                className="flex items-center gap-1 flex-1 cursor-pointer"
                onClick={() => onToggleFolder(node.path)}
              >
                {isExpanded ? (
                  <ChevronDown size={14} className="text-neutral-500" />
                ) : (
                  <ChevronRight size={14} className="text-neutral-500" />
                )}
                {isExpanded ? (
                  <FolderOpen size={16} className="text-blue-600 dark:text-blue-400" />
                ) : (
                  <Folder size={16} className="text-blue-600 dark:text-blue-400" />
                )}
                <span className="text-sm text-neutral-700 dark:text-neutral-300">
                  {node.name}
                </span>
              </div>
              
              {/* Folder Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename();
                  }}
                  className="p-1 text-neutral-400 hover:text-slate-600 dark:hover:text-slate-400 rounded transition-colors"
                  title="Rename folder"
                >
                  <Edit3 size={12} />
                </Button>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFolder(node.path);
                  }}
                  className="p-1 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
                  title="Delete folder"
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </>
          )}
        </div>
        {isExpanded && node.children && (
          <>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                level={level + 1}
                openTabs={openTabs}
                onFileClick={onFileClick}
                onDeleteFile={onDeleteFile}
                onDeleteFolder={onDeleteFolder}
                onRenameFile={onRenameFile}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                renamingFile={renamingFile}
                onStartRename={onStartRename}
                onCancelRename={onCancelRename}
              />
            ))}
          </>
        )}
      </>
    );
  }

  // File node
  const isTabOpen = openTabs.includes(node.path);

  return (
    <div
      className={`group flex items-center gap-2 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-md transition-colors`}
      style={{ marginLeft: `${level * 12 + 18}px` }}
    >
      {isBeingRenamed ? (
        <div className="flex items-center gap-1 flex-1">
          <FileIcon name={node.path} />
          <input
            type="text"
            value={renamingValue}
            onChange={(e) => setRenamingValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            className="flex-1 max-w-28 text-sm bg-white dark:bg-neutral-700 border border-slate-500 rounded px-2 py-1 text-neutral-900 dark:text-neutral-100 focus:ring-1 focus:ring-slate-500"
            onClick={(e) => e.stopPropagation()}
          />
          <Button
            onClick={(e) => {
              e.stopPropagation();
              saveRename();
            }}
            className="p-1 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 rounded transition-colors"
            title="Save"
          >
            <Check size={12} />
          </Button>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onCancelRename();
            }}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors"
            title="Cancel"
          >
            <X size={12} />
          </Button>
        </div>
      ) : (
        <>
          <Button
            onClick={() => onFileClick(node.path)}
            className="flex items-center gap-1 flex-1 text-left min-w-0"
          >
            <FileIcon name={node.path} />
            <span 
              className={`text-sm truncate ${
                isTabOpen 
                  ? 'font-medium text-neutral-900 dark:text-neutral-100' 
                  : 'text-neutral-700 dark:text-neutral-300'
              }`}
              title={node.name}
            >
              {node.name}
            </span>
          </Button>

          {/* File Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                startRename();
              }}
              className="p-1 text-neutral-400 hover:text-slate-600 dark:hover:text-slate-400 rounded transition-colors"
              title="Rename file"
            >
              <Edit3 size={12} />
            </Button>
            <Button
              onClick={(e) => onDeleteFile(node.path, e)}
              className="p-1 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
              title="Delete file"
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface ArtifactsBrowserProps {
  fs: FileSystemManager;
  openTabs: string[];
  onFileClick: (path: string) => void;
  onDeleteFile?: (path: string, event: React.MouseEvent) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDownloadAsZip?: () => Promise<void>;
}

export function ArtifactsBrowser({
  fs,
  openTabs,
  onFileClick,
  onDeleteFile,
  onRenameFile,
  onDownloadAsZip
}: ArtifactsBrowserProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [renamingFile, setRenamingFile] = useState<string | null>(null);

  // Default handlers that use fs directly
  const handleDeleteFile = onDeleteFile || ((path: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${getFileName(path)}"?`)) {
      fs.deleteFile(path);
    }
  });

  const handleDownloadAsZip = onDownloadAsZip || (() => fs.downloadAsZip());

  // Get all files from the file system
  const files = fs.listFiles().map(file => ({ path: file.path, content: file.content }));

  // Build the file tree
  const fileTree = buildFileTree(files);

  const handleDeleteFolder = (path: string) => {
    // Get all files within this folder
    const affectedFiles = files.filter(file => file.path.startsWith(path + '/'));
    const folderName = getFileName(path);
    
    if (affectedFiles.length === 0) {
      // Empty folder, just confirm deletion
      if (window.confirm(`Are you sure you want to delete the empty folder "${folderName}"?`)) {
        // Remove from expanded folders if it was expanded
        const newExpanded = new Set(expandedFolders);
        newExpanded.delete(path);
        setExpandedFolders(newExpanded);
      }
    } else {
      // Folder contains files, show detailed confirmation
      const fileCount = affectedFiles.length;
      const fileText = fileCount === 1 ? 'file' : 'files';
      if (window.confirm(`Are you sure you want to delete the folder "${folderName}" and all ${fileCount} ${fileText} inside it?`)) {
        // Use the file system's deleteFile method which now handles folders
        const success = fs.deleteFile(path);
        
        if (success) {
          // Remove from expanded folders
          const newExpanded = new Set(expandedFolders);
          newExpanded.delete(path);
          
          // Also remove any nested expanded folders
          const expandedArray = Array.from(newExpanded);
          for (const expandedPath of expandedArray) {
            if (expandedPath.startsWith(path + '/')) {
              newExpanded.delete(expandedPath);
            }
          }
          
          setExpandedFolders(newExpanded);
        }
      }
    }
  };

  const handleToggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  const handleRenameFile = (oldPath: string, newPath: string) => {
    if (onRenameFile) {
      // Use the provided callback
      onRenameFile(oldPath, newPath);
    } else {
      // Use the file system's built-in rename method which handles both files and folders
      const success = fs.renameFile(oldPath, newPath);
      if (!success) {
        console.error(`Failed to rename ${oldPath} to ${newPath}`);
        return;
      }
    }

    // Update expanded folders if this was a folder rename
    const isFolder = fileTree.some(node => {
      const findNode = (n: FileNode): boolean => {
        if (n.path === oldPath && n.type === 'folder') return true;
        if (n.children) {
          return n.children.some(findNode);
        }
        return false;
      };
      return findNode(node);
    });

    if (isFolder) {
      const newExpanded = new Set(expandedFolders);
      if (newExpanded.has(oldPath)) {
        newExpanded.delete(oldPath);
        newExpanded.add(newPath);
      }
      
      // Update any nested expanded folders
      const expandedArray = Array.from(newExpanded);
      for (const expandedPath of expandedArray) {
        if (expandedPath.startsWith(oldPath + '/')) {
          const relativePath = expandedPath.substring(oldPath.length);
          const newExpandedPath = newPath + relativePath;
          newExpanded.delete(expandedPath);
          newExpanded.add(newExpandedPath);
        }
      }
      setExpandedFolders(newExpanded);
    }
  };

  const handleStartRename = (path: string) => {
    setRenamingFile(path);
  };

  const handleCancelRename = () => {
    setRenamingFile(null);
  };

  return (
    <div className="w-64 h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <File size={32} className="text-neutral-300 dark:text-neutral-600 mb-3" />
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
              No files created yet
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-500">
              Files created by AI or dropped here will appear in this browser
            </p>
          </div>
        ) : (
          <div className="p-2">
            {/* Render file tree with folders */}
            {fileTree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                level={0}
                openTabs={openTabs}
                onFileClick={onFileClick}
                onDeleteFile={handleDeleteFile}
                onDeleteFolder={handleDeleteFolder}
                onRenameFile={handleRenameFile}
                expandedFolders={expandedFolders}
                onToggleFolder={handleToggleFolder}
                renamingFile={renamingFile}
                onStartRename={handleStartRename}
                onCancelRename={handleCancelRename}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Download Button at bottom of file browser */}
      {files.length > 0 && (
        <div className="p-2">
          <Button
            onClick={async () => {
              try {
                await handleDownloadAsZip();
              } catch (error) {
                console.error('Failed to download files:', error);
                alert('Failed to download files. Please try again.');
              }
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 rounded-md transition-colors text-sm"
            title={`Download all files as zip (${files.length} file${files.length !== 1 ? 's' : ''})`}
          >
            <Download size={14} />
            Download ZIP
          </Button>
        </div>
      )}
    </div>
  );
}
