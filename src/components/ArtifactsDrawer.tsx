import { useState, useEffect, useRef, useCallback } from 'react';
import { File as FileIcon2, Code, Eye, PanelRightOpen, PanelRightClose, Play, Loader2 } from 'lucide-react';
import { useArtifacts } from '../hooks/useArtifacts';
import { useChat } from '../hooks/useChat';
import { HtmlEditor } from './HtmlEditor';
import { SvgEditor } from './SvgEditor';
import { TextEditor } from './TextEditor';
import { CodeEditor } from './CodeEditor';
import { CsvEditor } from './CsvEditor';
import { MermaidEditor } from './MermaidEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { PythonEditor } from './PythonEditor';
import { JsEditor } from './JsEditor';
import { ArtifactsBrowser } from './ArtifactsBrowser';
import { artifactKind, artifactLanguage, processUploadedFile } from '../lib/artifacts';
import { FileIcon } from './FileIcon';
import { getFileName } from '../lib/utils';
import type { File } from '../types/file';

export function ArtifactsDrawer() {
  const {
    fs,
    activeFile,
    openFile,
    version,
    showFileBrowser,
    toggleFileBrowser,
  } = useArtifacts();
  const { chat, createChat } = useChat();

  const [isDragOver, setIsDragOver] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [isRunning, setIsRunning] = useState(false);
  const [runHandler, setRunHandler] = useState<(() => Promise<void>) | null>(null);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoShownBrowserRef = useRef(false);
  
  // State for files list (loaded from async fs.listFiles)
  const [files, setFiles] = useState<File[]>([]);
  
  // State for active file content (loaded from async fs.getFile)
  const [activeFileData, setActiveFileData] = useState<File | null>(null);

  // Callback for editors to register their run handler
  const onRunReady = useCallback((handler: (() => Promise<void>) | null) => {
    setRunHandler(() => handler);
  }, []);

  // Load files list when fs or version changes
  useEffect(() => {
    let cancelled = false;
    
    async function loadFiles() {
      if (!fs) {
        setFiles([]);
        return;
      }
      
      try {
        const fileList = await fs.listFiles();
        if (!cancelled) {
          setFiles(fileList.sort((a, b) => a.path.localeCompare(b.path)));
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
  }, [fs, version]);
  
  // Load active file content when activeFile changes
  useEffect(() => {
    let cancelled = false;
    
    async function loadActiveFile() {
      if (!fs || !activeFile) {
        setActiveFileData(null);
        return;
      }
      
      try {
        const file = await fs.getFile(activeFile);
        if (!cancelled) {
          setActiveFileData(file ?? null);
        }
      } catch (error) {
        console.error('Error loading active file:', error);
        if (!cancelled) {
          setActiveFileData(null);
        }
      }
    }
    
    loadActiveFile();
    
    return () => {
      cancelled = true;
    };
  }, [fs, activeFile, version]);

  // Automatically open the file if there's only one file
  // and show the browser if there are files but none selected
  useEffect(() => {
    if (activeFile) {
      hasAutoShownBrowserRef.current = false; // Reset when a file is selected
      return;
    }

    if (files.length === 1) {
      openFile(files[0].path);
    } else if (files.length > 0 && !showFileBrowser && !hasAutoShownBrowserRef.current) {
      hasAutoShownBrowserRef.current = true;
      toggleFileBrowser();
    }
  }, [files, activeFile, openFile, showFileBrowser, toggleFileBrowser]);

  // Drag and drop handlers
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }

    // IMPORTANT: Capture files immediately before any async work!
    // The browser clears e.dataTransfer after the sync part of the handler completes
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) {
      return;
    }

    // Create a chat if one doesn't exist (filesystem needs a chat to store files)
    if (!chat) {
      createChat();
    }

    // Wait for filesystem to be ready (handlers set up after chat creation)
    if (fs && !fs.isReady) {
      let attempts = 0;
      while (!fs.isReady && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 50));
        attempts++;
      }
    }

    for (const file of droppedFiles) {
      try {
        // Process file (converts XLSX to CSV automatically)
        const processedFiles = await processUploadedFile(file);

        for (const processed of processedFiles) {
          if (fs?.isReady) {
            await fs.createFile(processed.path, processed.content, processed.contentType);
            openFile(processed.path);
          }
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
        <div className="h-full flex flex-col items-center justify-center p-8 text-center">
          <Code size={64} className="text-neutral-300 dark:text-neutral-600 mb-6" />
          <h3 className="text-xl font-medium text-neutral-900 dark:text-neutral-100 mb-3">
            {files.length === 0 ? "No Artifacts Yet" : "Select a File"}
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 max-w-sm">
            {files.length === 0
              ? "Ask the AI to create code, documents, or other files — they'll appear here for you to view, edit, and download."
              : "Click a filename in the sidebar to open and edit it."}
          </p>
          {files.length === 0 && (
            <div className="text-xs text-neutral-500 dark:text-neutral-500 inline-flex flex-col items-start space-y-1">
              <p className="italic">"Create a Python script that..."</p>
              <p className="italic">"Write an HTML page for..."</p>
            </div>
          )}
        </div>
      );
    }

    if (!activeFileData) {
      return null;
    }

    const kind = artifactKind(activeFile);

    switch (kind) {
      case 'html':
        return <HtmlEditor key={`${activeFile}-${version}`} content={activeFileData.content} viewMode={viewMode} onViewModeChange={setViewMode} />;
      case 'svg':
        return <SvgEditor key={`${activeFile}-${version}`} content={activeFileData.content} viewMode={viewMode} onViewModeChange={setViewMode} />;
      case 'csv':
        return <CsvEditor key={`${activeFile}-${version}`} content={activeFileData.content} viewMode={viewMode === 'preview' ? 'table' : 'code'} onViewModeChange={(mode) => setViewMode(mode === 'table' ? 'preview' : 'code')} />;
      case 'mermaid':
        return <MermaidEditor key={`${activeFile}-${version}`} content={activeFileData.content} viewMode={viewMode} onViewModeChange={setViewMode} />;
      case 'markdown':
        return <MarkdownEditor key={`${activeFile}-${version}`} content={activeFileData.content} viewMode={viewMode} onViewModeChange={setViewMode} />;
      case 'code': {
        const lang = artifactLanguage(activeFileData.path);
        if (lang === 'py') {
          return <PythonEditor key={`${activeFile}-${version}`} content={activeFileData.content} onRunReady={onRunReady} onRunningChange={setIsRunning} />;
        }
        if (lang === 'js') {
          return <JsEditor key={`${activeFile}-${version}`} content={activeFileData.content} onRunReady={onRunReady} onRunningChange={setIsRunning} />;
        }
        return (
          <CodeEditor
            key={`${activeFile}-${version}`}
            content={activeFileData.content}
            language={lang}
          />
        );
      }
      case 'text':
      default:
        return <TextEditor key={`${activeFile}-${version}`} content={activeFileData.content} />;
    }
  };

  // Check if current file supports preview mode
  const supportsPreview = () => {
    if (!activeFile) return false;
    const kind = artifactKind(activeFile);
    return ['html', 'svg', 'csv', 'mermaid', 'markdown'].includes(kind);
  };

  // Handle run button click
  const handleRun = async () => {
    if (runHandler) {
      await runHandler();
    }
  };

  return (
    <div
      className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200 relative bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md pt-2 md:pt-0"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="text-center">
            <FileIcon2 size={48} className="text-blue-500 mx-auto mb-3" />
            <p className="text-lg font-medium text-blue-700 dark:text-blue-300 mb-1">
              Drop files here
            </p>
            <p className="text-sm text-blue-600 dark:text-blue-400">
              Files will be added to the project
            </p>
          </div>
        </div>
      )}

      {/* Main Content Area with Right Sidebar and Bottom Bar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main editor and bottom bar container */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Editor area */}
          <div className="flex-1 overflow-hidden">
            {renderEditor()}
          </div>

          {/* Bottom Bar with File Title and Actions */}
          <div className="shrink-0 h-14 flex border-t border-black/10 dark:border-white/10">
            {/* File title */}
            <div className="flex-1 flex items-center min-w-0 px-3">
              {activeFile && (
                <>
                  <FileIcon name={activeFile} />
                  <span className="text-sm font-medium truncate flex-1 text-left ml-1.5 text-neutral-700 dark:text-neutral-300" title={getFileName(activeFile)}>
                    {getFileName(activeFile)}
                  </span>
                </>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 px-2">
              {/* Run button - only show when editor has a run handler */}
              {runHandler && (
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={isRunning}
                  className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-green-600 dark:hover:text-green-400 disabled:opacity-50"
                  title={isRunning ? 'Running...' : 'Run'}
                >
                  {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                </button>
              )}

              {/* View mode toggle - only show for files that support preview */}
              {supportsPreview() && (
                <button
                  type="button"
                  onClick={() => setViewMode(viewMode === 'preview' ? 'code' : 'preview')}
                  className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                  title={viewMode === 'preview' ? 'Switch to code' : 'Switch to preview'}
                >
                  {viewMode === 'preview' ? <Code size={16} /> : <Eye size={16} />}
                </button>
              )}

              {/* File browser toggle */}
              {files.length > 0 && (
                <button
                  type="button"
                  onClick={toggleFileBrowser}
                  className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                  title={showFileBrowser ? 'Close file browser' : 'Open file browser'}
                >
                  {showFileBrowser ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Side Panel - File Browser (full height) */}
        <div className={`transition-all duration-500 ease-in-out relative ${showFileBrowser ? 'w-48 opacity-100' : 'w-0 opacity-0'
          } shrink-0 overflow-hidden`}>
          <div className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10"></div>
          {fs && (
            <div className={`h-full transition-opacity duration-500 ${showFileBrowser ? 'opacity-100' : 'opacity-0'}`}>
              <ArtifactsBrowser
                key={version}
                fs={fs}
                openTabs={activeFile ? [activeFile] : []}
                onFileClick={openFile}
                onUpload={async (fileList) => {
                  for (const file of Array.from(fileList)) {
                    try {
                      // Process file (converts XLSX to CSV automatically)
                      const processedFiles = await processUploadedFile(file);

                      for (const processed of processedFiles) {
                        await fs.createFile(processed.path, processed.content, processed.contentType);
                        openFile(processed.path);
                      }
                    } catch (error) {
                      console.error(`Error uploading file ${file.name}:`, error);
                    }
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
