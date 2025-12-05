import { useState, useEffect } from 'react';
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, Download } from 'lucide-react';
import { FileIcon } from './FileIcon';
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
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}

function FileTreeNode({ 
  node, 
  level, 
  openTabs, 
  onFileClick, 
  expandedFolders, 
  onToggleFolder
}: FileTreeNodeProps) {
  const isExpanded = expandedFolders.has(node.path);

  if (node.type === 'folder') {
    return (
      <>
        <div
          className="flex items-center gap-2 p-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer min-w-0"
          style={{ marginLeft: `${level * 12}px` }}
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
    <button
      type="button"
      onClick={() => onFileClick(node.path)}
      className="flex items-center gap-1 p-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left min-w-0"
      style={{ marginLeft: `${level * 12 + 18}px` }}
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
  );
}

interface ArtifactsBrowserProps {
  fs: FileSystemManager;
  openTabs: string[];
  onFileClick: (path: string) => void;
  onDownloadAsZip?: () => Promise<void>;
}

export function ArtifactsBrowser({
  fs,
  openTabs,
  onFileClick,
  onDownloadAsZip
}: ArtifactsBrowserProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Subscribe to filesystem events to handle UI state updates
  useEffect(() => {
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
    });

    return () => {
      unsubscribeCreated();
      unsubscribeDeleted();
    };
  }, [fs]);

  const handleDownloadAsZip = onDownloadAsZip || (() => fs.downloadAsZip());

  // Get all files from the filesystem
  const files = fs.listFiles().map(file => ({ path: file.path, content: file.content }));

  // Build the file tree
  const fileTree = buildFileTree(files);

  const handleToggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  return (
    <div className="w-64 h-full flex flex-col">
      {/* File list - grows to fill space */}
      <div className="flex-1 overflow-auto min-h-0">
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
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Download Button - fixed at bottom */}
      {files.length > 0 && (
        <div className="shrink-0 h-9 flex items-center px-2 border-t border-black/5 dark:border-white/5">
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
            className="w-full flex items-center justify-center gap-1.5 p-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors text-xs"
            title={`Download all files as zip (${files.length} file${files.length !== 1 ? 's' : ''})`}
          >
            <Download size={12} />
            <span>Download</span>
          </button>
        </div>
      )}
    </div>
  );
}
