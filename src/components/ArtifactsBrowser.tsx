import { useState, useEffect, useRef } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Download, Upload, MoreVertical, Trash, Edit2 } from 'lucide-react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { FileIcon } from './FileIcon';
import { FileSystemManager } from '../lib/fs';
import type { File } from '../types/file';

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
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile: (path: string) => void;
}

function FileTreeNode({ 
  node, 
  level, 
  openTabs, 
  onFileClick, 
  expandedFolders, 
  onToggleFolder,
  onDeleteFile,
  onRenameFile
}: FileTreeNodeProps) {
  const isExpanded = expandedFolders.has(node.path);

  if (node.type === 'folder') {
    return (
      <>
        <div
          className="flex items-center gap-2 p-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer min-w-0"
          style={{ marginLeft: `${level * 10}px` }}
          onClick={() => onToggleFolder(node.path)}
        >
          <div className="flex items-center gap-1 min-w-0">
            {isExpanded ? (
              <ChevronDown size={14} className="text-neutral-500 shrink-0" />
            ) : (
              <ChevronRight size={14} className="text-neutral-500 shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
            ) : (
              <Folder size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
            )}
            <span className="text-sm text-neutral-700 dark:text-neutral-300 truncate">
              {node.name}
            </span>
          </div>
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
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
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
      className="flex items-center gap-1 p-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors min-w-0 group relative"
      style={{ marginLeft: `${level * 10 + 14}px` }}
    >
      <button
        type="button"
        onClick={() => onFileClick(node.path)}
        className="flex items-center gap-1 flex-1 min-w-0 text-left"
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
      </button>
      <Menu>
        <MenuButton
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-0.5 rounded hover:bg-white/30 dark:hover:bg-black/20"
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
              onClick={() => onRenameFile(node.path)}
              className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-neutral-500/10 dark:data-focus:bg-neutral-500/20 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              <Edit2 size={14} />
              Rename
            </button>
          </MenuItem>
          <MenuItem>
            <button
              type="button"
              onClick={() => onDeleteFile(node.path)}
              className="group flex w-full items-center gap-2 rounded-md py-2 px-3 data-focus:bg-red-500/10 dark:data-focus:bg-red-500/20 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
            >
              <Trash size={14} />
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
  openTabs: string[];
  onFileClick: (path: string) => void;
  onDownloadAsZip?: () => Promise<void>;
  onUpload?: (files: FileList) => void;
}

export function ArtifactsBrowser({
  fs,
  openTabs,
  onFileClick,
  onDownloadAsZip,
  onUpload
}: ArtifactsBrowserProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load files asynchronously
  useEffect(() => {
    let cancelled = false;
    
    async function loadFiles() {
      try {
        const fileList = await fs.listFiles();
        if (!cancelled) {
          setFiles(fileList);
        }
      } catch (error) {
        console.error('Error loading files:', error);
        if (!cancelled) {
          setFiles([]);
        }
      }
    }
    
    loadFiles();
    
    return () => {
      cancelled = true;
    };
  }, [fs]);

  // Subscribe to filesystem events to handle UI state updates
  useEffect(() => {
    // Reload files when filesystem events occur
    const reloadFiles = async () => {
      try {
        const fileList = await fs.listFiles();
        setFiles(fileList);
      } catch (error) {
        console.error('Error reloading files:', error);
      }
    };

    const unsubscribeCreated = fs.subscribe('fileCreated', (path: string) => {
      // Auto-expand parent folders when new files are created
      const pathParts = path.split('/').filter(part => part.length > 0);
      setExpandedFolders(prev => {
        const newExpanded = new Set(prev);
        let currentPath = '';
        
        // Expand all parent folders up to the file
        for (let i = 0; i < pathParts.length - 1; i++) {
          currentPath += '/' + pathParts[i];
          newExpanded.add(currentPath);
        }
        
        return newExpanded;
      });
      reloadFiles();
    });

    const unsubscribeDeleted = fs.subscribe('fileDeleted', (path: string) => {
      // If a folder is deleted, remove it from expanded folders
      setExpandedFolders(prev => {
        const newExpanded = new Set(prev);
        newExpanded.delete(path);
        
        // Also remove any nested expanded folders
        const expandedArray = Array.from(newExpanded);
        for (const expandedPath of expandedArray) {
          if (expandedPath.startsWith(path + '/')) {
            newExpanded.delete(expandedPath);
          }
        }
        
        return newExpanded;
      });
      reloadFiles();
    });
    
    const unsubscribeRenamed = fs.subscribe('fileRenamed', () => {
      reloadFiles();
    });
    
    const unsubscribeUpdated = fs.subscribe('fileUpdated', () => {
      reloadFiles();
    });

    return () => {
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeRenamed();
      unsubscribeUpdated();
    };
  }, [fs]);

  const handleDownloadAsZip = onDownloadAsZip || (() => fs.downloadAsZip());

  // Build the file tree from files state
  const fileTree = buildFileTree(files.map(file => ({ path: file.path, content: file.content })));

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
    const fileName = path.split('/').pop() || '';
    setRenamingPath(path);
    setRenameValue(fileName);
  };

  const handleRenameSubmit = async () => {
    if (!renamingPath || !renameValue.trim()) return;
    
    const pathParts = renamingPath.split('/');
    pathParts[pathParts.length - 1] = renameValue.trim();
    const newPath = pathParts.join('/');
    
    if (newPath !== renamingPath) {
      const success = await fs.renameFile(renamingPath, newPath);
      if (!success) {
        alert('Failed to rename file. A file with that name may already exist.');
      }
    }
    
    setRenamingPath(null);
    setRenameValue('');
  };

  const handleRenameCancel = () => {
    setRenamingPath(null);
    setRenameValue('');
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* File list - grows to fill space */}
      <div className="flex-1 overflow-auto min-h-0">
        {files.length > 0 && (
          <div className="p-2 min-w-full">
            {/* Render file tree with folders */}
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
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Upload/Download Buttons - fixed at bottom, aligned with bottom bar */}
      {files.length > 0 && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && onUpload) {
                onUpload(e.target.files);
                e.target.value = ''; // Reset to allow re-uploading same file
              }
            }}
          />
          <div className="shrink-0 h-14 flex items-center justify-center border-t border-black/10 dark:border-white/10 gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
              title="Upload files"
            >
              <Upload size={16} />
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await handleDownloadAsZip();
                } catch (error) {
                  console.error('Failed to download files:', error);
                  alert('Failed to download files. Please try again.');
                }
              }}
              className="p-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
              title={`Download all files as zip (${files.length} file${files.length !== 1 ? 's' : ''})`}
            >
              <Download size={16} />
            </button>
          </div>
        </>
      )}

      {/* Rename Dialog */}
      {renamingPath && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleRenameCancel}>
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl p-4 w-80 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">Rename File</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameSubmit();
                } else if (e.key === 'Escape') {
                  handleRenameCancel();
                }
              }}
              className="w-full px-3 py-2 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded border border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
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
