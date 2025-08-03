import { useState, useEffect, useRef } from 'react';
import { X, Code, File, FolderTree } from 'lucide-react';
import { Button } from '@headlessui/react';
import { useArtifacts } from '../hooks/useArtifacts';
import { HtmlEditor } from './HtmlEditor';
import { SvgEditor } from './SvgEditor';
import { TextEditor } from './TextEditor';
import { CodeEditor } from './CodeEditor';
import { CsvEditor } from './CsvEditor';
import { MermaidEditor } from './MermaidEditor';
import { ArtifactsBrowser } from './ArtifactsBrowser';
import { artifactKind, artifactLanguage } from '../lib/artifacts';
import { FileIcon } from './FileIcon';
import { getFileName } from '../lib/utils';

export function ArtifactsDrawer() {
  const { 
    fs,
    openFiles, 
    activeFile, 
    openFile, 
    closeFile
  } = useArtifacts();

  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get all files sorted by path
  const files = fs ? fs.listFiles().sort((a, b) => a.path.localeCompare(b.path)) : [];

  // Auto-open file browser if no active file but files are available
  useEffect(() => {
    if (!activeFile && files.length > 0 && !showFileBrowser) {
      setShowFileBrowser(true);
    }
  }, [activeFile, files.length, showFileBrowser]);

  const selectFile = (path: string) => {
    if (activeFile === path) {
      return;
    }
    openFile(path);
  };

  const handleOpenFileFromBrowser = (path: string) => {
    openFile(path);
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
        
        // Read the file content as text
        const content = await file.text();
        
        // Create the file with string content
        if (fs) {
          fs.createFile(path, content, file.type);
          
          // Open the file in a tab
          openFile(path);
        }
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

  // Render the appropriate editor based on file type
  const renderEditor = () => {
    if (!activeFile) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <Code size={64} className="text-neutral-300 dark:text-neutral-600 mb-6" />
          <h3 className="text-xl font-medium text-neutral-900 dark:text-neutral-100 mb-2">
            No File Selected
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            {files.length === 0 
              ? "Files created by the AI will appear here" 
              : "Select a file from the tabs above or use the file browser"}
          </p>
          {files.length > 0 && (
            <Button
              onClick={() => setShowFileBrowser(true)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-900 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-white rounded-lg transition-colors text-sm"
            >
              Browse Files
            </Button>
          )}
        </div>
      );
    }

    const file = fs?.getFile(activeFile);
    if (!file) return null;

    switch (artifactKind(activeFile)) {
      case 'html':
        return <HtmlEditor content={file.content} />;
      case 'svg':
        return <SvgEditor content={file.content} />;
      case 'csv':
        return <CsvEditor content={file.content} />;
      case 'mermaid':
        return <MermaidEditor content={file.content} />;
      case 'code':
        return (
          <CodeEditor 
            content={file.content} 
            language={artifactLanguage(file.path)} 
          />
        );
      case 'text':
      default:
        return <TextEditor content={file.content} />;
    }
  };

  return (
    <div 
      className="h-full flex flex-col rounded-xl overflow-hidden animate-in fade-in duration-200 relative bg-white dark:bg-neutral-900"
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
      <div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-600 relative h-9 flex">
        {/* File Browser Button - Expands to match browser width */}
        <Button
          onClick={() => setShowFileBrowser(!showFileBrowser)}
          className={`flex items-center px-2.5 h-full text-xs flex-shrink-0 border-r border-neutral-200 dark:border-neutral-600 transition-all duration-300 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/30 ${
            showFileBrowser
              ? 'w-64 justify-start gap-1.5'
              : 'w-auto justify-center'
          }`}
          title="Browse files"
        >
          <FolderTree size={14} className="flex-shrink-0" />
          {showFileBrowser && (
            <span className="whitespace-nowrap">
              Files
            </span>
          )}
        </Button>

        {/* Scrollable Tabs Container */}
        <div className="flex-1 relative overflow-hidden">
          {/* Open File Tabs */}
          <div className="flex overflow-x-auto h-full hide-scrollbar" style={{ minWidth: '100%' }}>
            {openFiles.map((path) => {
              const file = fs?.getFile(path);
              if (!file) return null;
              
              const filename = getFileName(path);
              const isActive = activeFile === path;

              return (
                <Button
                  key={path}
                  onClick={() => selectFile(path)}
                  className={`flex items-center gap-1.5 px-3 h-full text-xs border-r border-neutral-200 dark:border-neutral-600 min-w-0 flex-shrink-0 whitespace-nowrap ${
                    isActive
                      ? 'text-neutral-900 dark:text-neutral-100 border-t-2 border-t-blue-500'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/30'
                  } transition-colors`}
                  style={{ minWidth: 'max-content' }}
                >
                  <FileIcon name={path} />
                  <span className="truncate max-w-[120px]" title={filename}>
                    {filename}
                  </span>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(path);
                    }}
                    className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors ml-0.5 opacity-70 hover:opacity-100 cursor-pointer"
                  >
                    <X size={12} />
                  </div>
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content Area with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side Panel - File Browser */}
        <div className={`transition-all duration-300 ease-out ${
          showFileBrowser ? 'w-64' : 'w-0'
        } flex-shrink-0 overflow-hidden ${showFileBrowser ? 'border-r border-neutral-200 dark:border-neutral-600' : ''}`}>
          {showFileBrowser && fs && (
            <ArtifactsBrowser
              fs={fs}
              openTabs={openFiles}
              onFileClick={handleOpenFileFromBrowser}
            />
          )}
        </div>
        
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderEditor()}
        </div>
      </div>
    </div>
  );
}
