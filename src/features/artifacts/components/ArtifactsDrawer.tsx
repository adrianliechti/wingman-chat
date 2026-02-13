import { useState, useEffect, useRef, useCallback } from 'react';
import { File as FileIcon2, Code, Eye, PanelRightOpen, PanelRightClose, Play, Loader2 } from 'lucide-react';
import { useArtifacts } from '@/features/artifacts/hooks/useArtifacts';
import { useChat } from '@/features/chat/hooks/useChat';
import { HtmlEditor } from '@/shared/ui/editors/HtmlEditor';
import { SvgEditor } from '@/shared/ui/editors/SvgEditor';
import { TextEditor } from '@/shared/ui/editors/TextEditor';
import { CodeEditor } from '@/shared/ui/editors/CodeEditor';
import { CsvEditor } from '@/shared/ui/editors/CsvEditor';
import { MermaidEditor } from '@/shared/ui/editors/MermaidEditor';
import { MarkdownEditor } from '@/shared/ui/editors/MarkdownEditor';
import { PythonEditor } from '@/shared/ui/editors/PythonEditor';
import { JsEditor } from '@/shared/ui/editors/JsEditor';
import { ArtifactsBrowser } from './ArtifactsBrowser';
import { artifactKind, artifactLanguage, processUploadedFile } from '@/features/artifacts/lib/artifacts';
import { FileIcon } from '@/shared/ui/FileIcon';
import { getFileName } from '@/shared/lib/utils';
import type { File } from '@/features/artifacts/types/file';

export function ArtifactsDrawer() {
  const {
    fs,
    activeFile,
    openFile,
  } = useArtifacts();
  const { chat, createChat } = useChat();

  const [isDragOver, setIsDragOver] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [isRunning, setIsRunning] = useState(false);
  const [runHandler, setRunHandler] = useState<(() => Promise<void>) | null>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasAutoShownBrowser, setHasAutoShownBrowser] = useState(false);
  
  // State for files list (loaded from async fs.listFiles)
  const [files, setFiles] = useState<File[]>([]);
  
  // State for active file content (loaded from async fs.getFile)
  const [activeFileData, setActiveFileData] = useState<File | null>(null);
  
  // Local version counter for forcing editor remounts when file content changes
  const [editorVersion, setEditorVersion] = useState(0);
  
  // Toggle file browser visibility
  const toggleFileBrowser = useCallback(() => {
    setShowFileBrowser(prev => !prev);
  }, []);

  // Callback for editors to register their run handler
  const onRunReady = useCallback((handler: (() => Promise<void>) | null) => {
    setRunHandler(() => handler);
  }, []);

  // Subscribe to filesystem events and load data
  useEffect(() => {
    let cancelled = false;

    // Helper to load files list
    const loadFiles = async () => {
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
    };

    // Helper to load active file content
    const loadActiveFile = async () => {
      if (!fs || !activeFile) {
        if (!cancelled) {
          setActiveFileData(null);
        }
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
    };

    // Load initial data
    loadFiles();
    loadActiveFile();

    // Subscribe to events for subsequent updates
    const handleFileChange = () => {
      loadFiles();
      loadActiveFile();
      setEditorVersion(v => v + 1);
    };

    const unsubscribeCreated = fs.subscribe('fileCreated', handleFileChange);
    const unsubscribeDeleted = fs.subscribe('fileDeleted', handleFileChange);
    const unsubscribeRenamed = fs.subscribe('fileRenamed', handleFileChange);
    const unsubscribeUpdated = fs.subscribe('fileUpdated', handleFileChange);

    return () => {
      cancelled = true;
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeRenamed();
      unsubscribeUpdated();
    };
  }, [fs, activeFile]);

  // Track previous values for "adjust state during render" pattern
  const [prevFiles, setPrevFiles] = useState(files);
  const [prevActiveFile, setPrevActiveFile] = useState(activeFile);

  // Adjust state during render when files or activeFile changes
  // This is React's recommended pattern for updating state based on props/state changes
  if (files !== prevFiles || activeFile !== prevActiveFile) {
    setPrevFiles(files);
    setPrevActiveFile(activeFile);
    
    if (activeFile) {
      setHasAutoShownBrowser(false); // Reset when a file is selected
    } else if (files.length === 1) {
      // Will trigger openFile in effect below (can't call during render as it's async)
    } else if (files.length > 0 && !showFileBrowser && !hasAutoShownBrowser) {
      setHasAutoShownBrowser(true);
      setShowFileBrowser(true);
    }
  }

  // Handle auto-opening single file (needs effect since openFile is async)
  useEffect(() => {
    if (!activeFile && files.length === 1) {
      openFile(files[0].path);
    }
  }, [files, activeFile, openFile]);

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
      await createChat();
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
        return <HtmlEditor key={`${activeFile}-${editorVersion}`} content={activeFileData.content} viewMode={viewMode} onViewModeChange={setViewMode} />;
      case 'svg':
        return <SvgEditor key={`${activeFile}-${editorVersion}`} content={activeFileData.content} viewMode={viewMode} onViewModeChange={setViewMode} />;
      case 'csv':
        return <CsvEditor key={`${activeFile}-${editorVersion}`} content={activeFileData.content} viewMode={viewMode === 'preview' ? 'table' : 'code'} onViewModeChange={(mode) => setViewMode(mode === 'table' ? 'preview' : 'code')} />;
      case 'mermaid':
        return <MermaidEditor key={`${activeFile}-${editorVersion}`} content={activeFileData.content} viewMode={viewMode} onViewModeChange={setViewMode} />;
      case 'markdown':
        return <MarkdownEditor key={`${activeFile}-${editorVersion}`} content={activeFileData.content} viewMode={viewMode} onViewModeChange={setViewMode} />;
      case 'code': {
        const lang = artifactLanguage(activeFileData.path);
        if (lang === 'py') {
          return <PythonEditor key={`${activeFile}-${editorVersion}`} content={activeFileData.content} onRunReady={onRunReady} onRunningChange={setIsRunning} />;
        }
        if (lang === 'js') {
          return <JsEditor key={`${activeFile}-${editorVersion}`} content={activeFileData.content} onRunReady={onRunReady} onRunningChange={setIsRunning} />;
        }
        return (
          <CodeEditor
            key={`${activeFile}-${editorVersion}`}
            content={activeFileData.content}
            language={lang}
          />
        );
      }
      case 'text':
      default:
        return <TextEditor key={`${activeFile}-${editorVersion}`} content={activeFileData.content} />;
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
                fs={fs}
                files={files}
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
