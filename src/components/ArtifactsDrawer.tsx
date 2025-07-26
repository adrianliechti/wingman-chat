import { useState, useEffect, useRef } from 'react';
import { X, FileText, Code, Edit3, Trash2, File, FolderTree, Folder, FolderOpen, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { Button } from '@headlessui/react';
import { useArtifacts } from '../hooks/useArtifacts';

// Component to display Blob content as text
function BlobContentViewer({ blob }: { blob: Blob }) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const readBlob = async () => {
      try {
        const text = await blob.text();
        setContent(text);
      } catch {
        setContent('Error reading file content');
      } finally {
        setLoading(false);
      }
    };

    readBlob();
  }, [blob]);

  if (loading) return <div>Loading...</div>;
  return <>{content}</>;
}

// Helper function to get file icon based on file extension
function getFileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  
  // Code files
  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'go', 'py', 'rs', 'java', 'cpp', 'cc', 'cxx', 'c'];
  if (codeExtensions.includes(ext || '')) {
    return <Code size={16} className="text-blue-600 dark:text-blue-400" />;
  }
  
  // Markup/config files
  const markupExtensions = ['html', 'css', 'json', 'xml', 'yaml', 'yml'];
  if (markupExtensions.includes(ext || '')) {
    return <FileText size={16} className="text-green-600 dark:text-green-400" />;
  }
  
  // Markdown
  if (ext === 'md') {
    return <FileText size={16} className="text-orange-600 dark:text-orange-400" />;
  }
  
  // Default file icon
  return <FileText size={16} className="text-neutral-600 dark:text-neutral-400" />;
}

// Helper function to extract filename from path
function getFilename(path: string): string {
  return path.split('/').pop() || path;
}

// Helper function to build folder tree structure
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  file?: { path: string; content: Blob }; // Reference to the actual file object
}

function buildFileTree(files: { path: string; content: Blob }[]): FileNode[] {
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
  const indentStyle = { paddingLeft: `${level * 12 + 8}px` };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    
    if (e.key === 'Enter') {
      e.preventDefault();
      if (renamingValue.trim() && renamingValue !== node.name) {
        if (node.type === 'folder') {
          // For folders, update the folder path
          const pathParts = node.path.split('/');
          pathParts[pathParts.length - 1] = renamingValue.trim();
          const newPath = pathParts.join('/');
          onRenameFile(node.path, newPath);
        } else {
          // For files, update the filename
          const pathParts = node.path.split('/');
          pathParts[pathParts.length - 1] = renamingValue.trim();
          const newPath = pathParts.join('/');
          onRenameFile(node.path, newPath);
        }
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
      if (node.type === 'folder') {
        // For folders, update the folder path
        const pathParts = node.path.split('/');
        pathParts[pathParts.length - 1] = renamingValue.trim();
        const newPath = pathParts.join('/');
        onRenameFile(node.path, newPath);
      } else {
        // For files, update the filename
        const pathParts = node.path.split('/');
        pathParts[pathParts.length - 1] = renamingValue.trim();
        const newPath = pathParts.join('/');
        onRenameFile(node.path, newPath);
      }
    }
    onCancelRename();
  };

  if (node.type === 'folder') {
    return (
      <>
        <div
          className="group flex items-center gap-2 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-md transition-colors"
          style={indentStyle}
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
                className="flex-1 text-sm bg-white dark:bg-neutral-700 border border-slate-500 rounded px-2 py-1 text-neutral-900 dark:text-neutral-100 focus:ring-1 focus:ring-slate-500"
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
      className="group flex items-center gap-2 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-md transition-colors"
      style={indentStyle}
    >
      {isBeingRenamed ? (
        <div className="flex items-center gap-2 flex-1">
          {getFileIcon(node.path)}
          <input
            type="text"
            value={renamingValue}
            onChange={(e) => setRenamingValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            className="flex-1 text-sm bg-white dark:bg-neutral-700 border border-slate-500 rounded px-2 py-1 text-neutral-900 dark:text-neutral-100 focus:ring-1 focus:ring-slate-500"
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
            className="flex items-center gap-2 flex-1 text-left min-w-0"
          >
            {getFileIcon(node.path)}
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

export function ArtifactsDrawer() {
  const { 
    filesystem, 
    openTabs, 
    activeTab, 
    openTab, 
    closeTab, 
    setActiveTab,
    deleteFile,
    getFile,
    createFile
  } = useArtifacts();

  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get all files sorted by path
  const allFiles = Object.values(filesystem).sort((a, b) => a.path.localeCompare(b.path));
  
  // Build the file tree
  const fileTree = buildFileTree(allFiles);

  const handleTabClick = (path: string) => {
    if (activeTab === path) {
      return;
    }
    setActiveTab(path);
  };

  const handleDeleteFile = (path: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${getFilename(path)}"?`)) {
      deleteFile(path);
    }
  };

  const handleDeleteFolder = (path: string) => {
    // Get all files within this folder
    const affectedFiles = allFiles.filter(file => file.path.startsWith(path + '/'));
    const folderName = getFilename(path);
    
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
        // Delete all files within the folder
        for (const file of affectedFiles) {
          // Close tab if file is open
          if (openTabs.includes(file.path)) {
            closeTab(file.path);
          }
          // Clear active tab if this file is active
          if (activeTab === file.path) {
            setActiveTab(null);
          }
          // Delete the file
          deleteFile(file.path);
        }
        
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
  };

  const handleOpenFileFromBrowser = (path: string) => {
    openTab(path);
    // Keep the file browser open when a file is selected
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
    // Check if this is a folder rename by looking at the file tree structure
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
      // This is a folder - rename all files within this folder
      const affectedFiles = allFiles.filter(file => file.path.startsWith(oldPath + '/'));
      
      // Rename all affected files
      for (const file of affectedFiles) {
        const relativePath = file.path.substring(oldPath.length);
        const newFilePath = newPath + relativePath;
        
        // Create new file with updated path
        createFile(newFilePath, file.content);
        
        // Update tabs if necessary
        if (activeTab === file.path) {
          setActiveTab(newFilePath);
        }
        if (openTabs.includes(file.path)) {
          closeTab(file.path);
          openTab(newFilePath);
        }
        
        // Delete old file
        deleteFile(file.path);
      }
      
      // Update expanded folders
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
    } else {
      // This is a file rename
      const file = getFile(oldPath);
      if (file) {
        // Create new file with new path
        createFile(newPath, file.content);
        // Delete old file
        deleteFile(oldPath);
        // Update active tab if this file was active
        if (activeTab === oldPath) {
          setActiveTab(newPath);
        }
        // Update open tabs
        if (openTabs.includes(oldPath)) {
          closeTab(oldPath);
          openTab(newPath);
        }
      }
    }
  };

  const handleStartRename = (path: string) => {
    setRenamingFile(path);
  };

  const handleCancelRename = () => {
    setRenamingFile(null);
  };

  // Drag and drop handlers
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    // Clear any pending timeout
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }

    const files = Array.from(e.dataTransfer.files);
    
    for (const file of files) {
      try {
        const path = `/${file.name}`;
        
        // Create the file using the original file as a Blob (preserves content and type)
        createFile(path, file);
        
        // Open the file in a tab
        openTab(path);
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    
    if (!isDragOver) {
      setIsDragOver(true);
    }
    
    // Clear any existing timeout and set a new one
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
    }
    
    // Reset drag state after a short delay if no more drag events
    dragTimeoutRef.current = setTimeout(() => {
      setIsDragOver(false);
      dragTimeoutRef.current = null;
    }, 100);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div 
      className="h-full flex flex-col rounded-xl overflow-hidden animate-in fade-in duration-200 relative"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-xl flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="text-center">
            <File size={48} className="text-blue-500 mx-auto mb-3" />
            <p className="text-lg font-medium text-blue-700 dark:text-blue-300 mb-1">
              Drop files here
            </p>
            <p className="text-sm text-blue-600 dark:text-blue-400">
              Files will be added to the project
            </p>
          </div>
        </div>
      )}
      {/* Tab Bar with File Browser Button - Fixed at top */}
      <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700 relative h-9">
        <div className="flex overflow-x-auto scrollbar-hide h-full">
          {/* File Browser Button */}
          <Button
            onClick={() => setShowFileBrowser(!showFileBrowser)}
            className={`flex items-center justify-center gap-1.5 px-2.5 h-full text-xs flex-shrink-0 border-r border-neutral-200 dark:border-neutral-700 ${
              showFileBrowser
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-b-2 border-b-blue-500'
                : 'bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-white dark:hover:bg-neutral-800'
            } transition-colors`}
            title="Browse files"
          >
            <FolderTree size={14} />
          </Button>

          {/* Open File Tabs */}
          {openTabs.map((path) => {
            const file = getFile(path);
            if (!file) return null;
            
            const filename = getFilename(path);
            const isActive = activeTab === path;

            return (
              <Button
                key={path}
                onClick={() => handleTabClick(path)}
                className={`flex items-center gap-1.5 px-3 h-full text-xs border-r border-neutral-200 dark:border-neutral-700 min-w-0 flex-shrink-0 ${
                  isActive
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border-b-2 border-b-blue-500'
                    : 'bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-white dark:hover:bg-neutral-800'
                } transition-colors`}
              >
                {getFileIcon(path)}
                <span className="truncate max-w-[120px]" title={filename}>
                  {filename}
                </span>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(path);
                  }}
                  className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors ml-0.5"
                >
                  <X size={12} />
                </Button>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Content Area with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side Panel - File Browser (pushes content aside) */}
        <div className={`transition-all duration-300 ease-out ${
          showFileBrowser ? 'w-64' : 'w-0'
        } flex-shrink-0 overflow-hidden bg-neutral-100 dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700`}>
          {showFileBrowser && (
            <div className="w-64 h-full flex flex-col">
              <div className="flex-1 overflow-auto">
                {allFiles.length === 0 ? (
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
                <div className="p-1">
                  {/* Render file tree with folders */}
                  {fileTree.map((node) => (
                    <FileTreeNode
                      key={node.path}
                      node={node}
                      level={0}
                      openTabs={openTabs}
                      onFileClick={handleOpenFileFromBrowser}
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
            </div>
          )}
        </div>        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-auto p-4">
                <div className="bg-neutral-50 dark:bg-neutral-900 rounded-lg p-4 h-full">
                  <pre className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap font-mono h-full overflow-auto">
                    {getFile(activeTab)?.content && <BlobContentViewer blob={getFile(activeTab)!.content} />}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <Code size={64} className="text-neutral-300 dark:text-neutral-600 mb-6" />
              <h3 className="text-xl font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                No File Selected
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                {allFiles.length === 0 
                  ? "Files created by the AI will appear here" 
                  : "Select a file from the tabs above or use the file browser"}
              </p>
              {allFiles.length > 0 && (
                <Button
                  onClick={() => setShowFileBrowser(true)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-900 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-white rounded-lg transition-colors text-sm"
                >
                  Browse Files
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
