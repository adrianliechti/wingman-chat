import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Code, Download, Eye, File as FileIcon2, HardDrive, Loader2, Play, Shapes, TerminalSquare, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { artifactKind, artifactLanguage, processUploadedFile } from "@/features/artifacts/lib/artifacts";
import type { File, FileEntry } from "@/features/artifacts/types/file";
import { useChat } from "@/features/chat/hooks/useChat";
import { getConfig } from "@/shared/config";
import { getDriveContentUrl } from "@/shared/lib/drives";
import { markdownToDocx } from "@/shared/lib/markdownToDocx";
import { downloadBlob, getFileName } from "@/shared/lib/utils";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { BashEditor } from "@/shared/ui/editors/BashEditor";
import { CodeEditor } from "@/shared/ui/editors/CodeEditor";
import { CsvEditor } from "@/shared/ui/editors/CsvEditor";
import { HtmlEditor } from "@/shared/ui/editors/HtmlEditor";
import { JsEditor } from "@/shared/ui/editors/JsEditor";
import { MarkdownEditor } from "@/shared/ui/editors/MarkdownEditor";
import { PythonEditor } from "@/shared/ui/editors/PythonEditor";
import { SvgEditor } from "@/shared/ui/editors/SvgEditor";
import { TextEditor } from "@/shared/ui/editors/TextEditor";
import { FileIcon } from "@/shared/ui/FileIcon";
import { ArtifactsBrowser } from "./ArtifactsBrowser";

export function ArtifactsDrawer() {
  const config = getConfig();
  const { fs, activeFile, openFile } = useArtifacts();
  const { chat, createChat } = useChat();

  const [isDragOver, setIsDragOver] = useState(false);
  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [isRunning, setIsRunning] = useState(false);
  const [runHandler, setRunHandler] = useState<(() => Promise<void>) | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State for files list (loaded from async fs.listFiles)
  const [files, setFiles] = useState<FileEntry[]>([]);

  // State for active file content (loaded from async fs.getFile)
  const [activeFileData, setActiveFileData] = useState<File | null>(null);

  // Processing state for file uploads
  const [isProcessing, setIsProcessing] = useState(false);

  // Ensure a chat exists and FS is ready (creates chat if needed)
  const ensureFs = useCallback(async () => {
    if (!chat) {
      await createChat();
    }
    if (fs && !fs.isReady) {
      let attempts = 0;
      while (!fs.isReady && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        attempts++;
      }
    }
  }, [chat, createChat, fs]);

  const uploadFiles = useCallback(
    async (fileList: globalThis.File[]) => {
      await ensureFs();
      setIsProcessing(true);
      try {
        for (const file of fileList) {
          try {
            const processedFiles = await processUploadedFile(file);
            for (const processed of processedFiles) {
              if (fs?.isReady) {
                await fs.createFile(processed.path, processed.content, processed.contentType);
                openFile(processed.path);
              }
            }
          } catch (error) {
            console.error(`Error uploading file ${file.name}:`, error);
          }
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [ensureFs, fs, openFile],
  );

  const handleDriveFiles = useCallback(
    async (selected: SelectedFile[]) => {
      setIsProcessing(true);
      try {
        const fetched: globalThis.File[] = [];
        for (const f of selected) {
          const url = getDriveContentUrl(f.driveId, f.id);
          const resp = await fetch(url);
          const blob = await resp.blob();
          fetched.push(new globalThis.File([blob], f.name, { type: f.mime || blob.type || "" }));
        }
        await uploadFiles(fetched);
      } finally {
        setIsProcessing(false);
      }
    },
    [uploadFiles],
  );

  // Toggle terminal panel (auto-creates chat if needed)
  const toggleTerminal = useCallback(async () => {
    const opening = !showTerminal;
    if (opening) {
      await ensureFs();
      setTerminalMounted(true);
    }
    setShowTerminal(opening);
  }, [showTerminal, ensureFs]);

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
        const fileList = await fs.listEntries();
        if (!cancelled) {
          setFiles(fileList);
        }
      } catch (error) {
        console.error("Error loading files:", error);
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
        console.error("Error loading active file:", error);
        if (!cancelled) {
          setActiveFileData(null);
        }
      }
    };

    // Load initial data
    loadFiles();
    loadActiveFile();

    // Subscribe to events for subsequent updates.
    // Reload the sidebar list for every filesystem change, but only refresh
    // the active editor content when that specific file is affected.
    const handleFileCreated = () => {
      void loadFiles();
    };

    const handleFileDeleted = (path: string) => {
      void loadFiles();

      if (path === activeFile && !cancelled) {
        setActiveFileData(null);
      }
    };

    const handleFileRenamed = (oldPath: string, newPath: string) => {
      void loadFiles();

      if (activeFile === oldPath || activeFile === newPath) {
        void loadActiveFile();
      }
    };

    const handleFileUpdated = (path: string) => {
      void loadFiles();

      if (path === activeFile) {
        void loadActiveFile();
      }
    };

    const unsubscribeCreated = fs.subscribe("fileCreated", handleFileCreated);
    const unsubscribeDeleted = fs.subscribe("fileDeleted", handleFileDeleted);
    const unsubscribeRenamed = fs.subscribe("fileRenamed", handleFileRenamed);
    const unsubscribeUpdated = fs.subscribe("fileUpdated", handleFileUpdated);

    return () => {
      cancelled = true;
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeRenamed();
      unsubscribeUpdated();
    };
  }, [fs, fs?.chatId, activeFile]);

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

    // Ensure a chat and FS exist before writing files
    await ensureFs();

    setIsProcessing(true);
    try {
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
    } finally {
      setIsProcessing(false);
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
    return renderFileEditor();
  };

  // Render the file-specific editor
  const renderFileEditor = () => {
    if (!activeFile) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-8">
          <div className="w-full max-w-xl">
            <Shapes size={32} className="text-neutral-300 dark:text-neutral-600 mb-4" />
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
              {files.length === 0 ? "No artifacts yet" : "Select a file"}
            </h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed mb-5">
              {files.length === 0
                ? "Artifacts are files, code, and documents created during the conversation. Upload your own files, run Python or shell commands, and download the results when ready."
                : "Click a filename in the sidebar to open and edit it."}
            </p>
            {files.length === 0 && (
              <>
                <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wide mb-2">
                  Try asking
                </p>
                <ul className="space-y-2">
                  {[
                    "Analyze this CSV and create a chart showing the top trends.",
                    "Write a Python script that cleans up and merges these two spreadsheets.",
                    "Turn these rough notes into a polished, client-ready document.",
                  ].map((example) => (
                    <li
                      key={example}
                      className="text-xs text-neutral-500 dark:text-neutral-400 italic bg-black/5 dark:bg-white/5 rounded-md px-3 py-2 leading-relaxed"
                    >
                      &ldquo;{example}&rdquo;
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      );
    }

    if (!activeFileData) {
      return null;
    }

    const editorKey = activeFileData.path;
    const kind = artifactKind(activeFileData.path, activeFileData.contentType);

    switch (kind) {
      case "image":
        return (
          <div className="h-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-900/60 p-6 overflow-auto">
            <img
              key={editorKey}
              src={activeFileData.content}
              alt={getFileName(activeFileData.path)}
              className="max-w-full max-h-full object-contain rounded-md shadow-sm"
              draggable={false}
            />
          </div>
        );
      case "binary":
        return (
          <div className="h-full flex items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-900/60">
            <div className="max-w-md text-center">
              <FileIcon2 size={32} className="mx-auto mb-4 text-neutral-300 dark:text-neutral-600" />
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Binary File</h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                This file is stored as binary data and cannot be edited as plain text here.
              </p>
              <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                {activeFileData.contentType || "application/octet-stream"}
              </p>
            </div>
          </div>
        );
      case "html":
        return (
          <HtmlEditor
            key={editorKey}
            path={activeFileData.path}
            content={activeFileData.content}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "svg":
        return (
          <SvgEditor
            key={editorKey}
            content={activeFileData.content}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "csv":
        return (
          <CsvEditor
            key={editorKey}
            content={activeFileData.content}
            viewMode={viewMode === "preview" ? "table" : "code"}
            onViewModeChange={(mode) => setViewMode(mode === "table" ? "preview" : "code")}
          />
        );
      case "markdown":
        return (
          <MarkdownEditor
            key={editorKey}
            content={activeFileData.content}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "code": {
        const lang = artifactLanguage(activeFileData.path);
        if (lang === "py") {
          return (
            <PythonEditor
              key={editorKey}
              content={activeFileData.content}
              onRunReady={onRunReady}
              onRunningChange={setIsRunning}
            />
          );
        }
        if (lang === "js") {
          return (
            <JsEditor
              key={editorKey}
              content={activeFileData.content}
              onRunReady={onRunReady}
              onRunningChange={setIsRunning}
            />
          );
        }
        if (lang === "sh" || lang === "bash") {
          return (
            <BashEditor
              key={editorKey}
              initialScript={activeFileData.content}
              onRunReady={onRunReady}
              onRunningChange={setIsRunning}
            />
          );
        }
        return <CodeEditor key={editorKey} content={activeFileData.content} language={lang} />;
      }
      default:
        return <TextEditor key={editorKey} content={activeFileData.content} />;
    }
  };

  // Check if current file supports preview mode
  const supportsPreview = () => {
    if (!activeFile) return false;
    const kind = activeFileData
      ? artifactKind(activeFileData.path, activeFileData.contentType)
      : artifactKind(activeFile);
    return ["html", "svg", "csv", "markdown"].includes(kind);
  };

  // Handle run button click
  const handleRun = async () => {
    if (runHandler) {
      await runHandler();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: File drag-and-drop requires drag events on the drawer surface.
    <div
      className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200 relative bg-white/80 dark:bg-neutral-950/90 backdrop-blur-md pt-2 md:pt-0"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-neutral-500/10 border-2 border-dashed border-neutral-400 dark:border-neutral-500 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="text-center">
            <FileIcon2 size={48} className="text-neutral-500 mx-auto mb-3" />
            <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-1">Drop files here</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Files will be added to the project</p>
          </div>
        </div>
      )}

      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          if (!e.target.files || e.target.files.length === 0) return;
          const selectedFiles = Array.from(e.target.files);
          e.target.value = "";
          await uploadFiles(selectedFiles);
        }}
      />

      {/* Main Content Area with Right Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor area */}
        <div className="flex-1 overflow-hidden">{renderEditor()}</div>

        {/* Right Side Panel - File Browser (full height) */}
        <div
          className={`transition-all duration-500 ease-in-out relative ${files.length > 0 ? "w-48 opacity-100" : "w-0 opacity-0"} shrink-0 overflow-hidden`}
        >
          <div className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10"></div>
          {fs && (
            <div className={`h-full transition-opacity duration-500 ${files.length > 0 ? "opacity-100" : "opacity-0"}`}>
              <ArtifactsBrowser
                fs={fs}
                files={files}
                openTabs={activeFile ? [activeFile] : []}
                onFileClick={openFile}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Bar with File Title and Actions — full width */}
      <div className="shrink-0 h-14 flex border-t border-black/10 dark:border-white/10">
        {/* File title */}
        <div className="flex-1 flex items-center min-w-0 px-3">
          {activeFile && (
            <>
              <FileIcon name={activeFile} />
              <span
                className="text-sm font-medium truncate flex-1 text-left ml-1.5 text-neutral-700 dark:text-neutral-300"
                title={getFileName(activeFile)}
              >
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
              title={isRunning ? "Running..." : "Run"}
            >
              {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            </button>
          )}

          {/* View mode toggle - only show for files that support preview */}
          {supportsPreview() && (
            <button
              type="button"
              onClick={() => setViewMode(viewMode === "preview" ? "code" : "preview")}
              className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
              title={viewMode === "preview" ? "Switch to code" : "Switch to preview"}
            >
              {viewMode === "preview" ? <Code size={16} /> : <Eye size={16} />}
            </button>
          )}

          {/* Word download button — only for markdown files */}
          {activeFileData && artifactKind(activeFileData.path, activeFileData.contentType) === "markdown" && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const blob = await markdownToDocx(activeFileData.content);
                  const baseName = getFileName(activeFileData.path).replace(/\.(md|markdown)$/i, "");
                  downloadBlob(blob, `${baseName}.docx`);
                } catch (error) {
                  console.error("Failed to convert to Word:", error);
                }
              }}
              className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
              title="Download as Word (.docx)"
            >
              <img src="/icons/file-word.svg" alt="Word" width={16} height={16} className="dark:invert" />
            </button>
          )}

          {/* Terminal toggle */}
          <button
            type="button"
            onClick={toggleTerminal}
            className={`p-2 rounded transition-all duration-150 ease-out ${showTerminal ? "text-green-500 dark:text-green-400 bg-green-500/10" : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
            title={showTerminal ? "Close terminal" : "Open terminal"}
          >
            <TerminalSquare size={16} />
          </button>

          {/* Upload button — always visible */}
          {isProcessing ? (
            <div className="p-2">
              <Loader2 size={16} className="animate-spin text-neutral-400" />
            </div>
          ) : config.drives.length > 0 ? (
            <Menu>
              <MenuButton
                className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                title="Upload files"
              >
                <Upload size={16} />
              </MenuButton>
              <MenuItems
                modal={false}
                transition
                anchor="bottom end"
                className="mt-1 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-lg py-1 z-50 min-w-40"
              >
                <MenuItem>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 transition-colors"
                  >
                    <Upload size={15} className="text-neutral-500" />
                    Upload
                  </button>
                </MenuItem>
                {config.drives.map((drive) => (
                  <MenuItem key={drive.id}>
                    <button
                      type="button"
                      onClick={() => setActiveDrive(drive)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 transition-colors"
                    >
                      <HardDrive size={15} className="text-neutral-500" />
                      {drive.name}
                    </button>
                  </MenuItem>
                ))}
              </MenuItems>
            </Menu>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
              title="Upload files"
            >
              <Upload size={16} />
            </button>
          )}

          {/* Download button — only when files exist */}
          {files.length > 0 && fs && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await fs.downloadAsZip();
                } catch (error) {
                  console.error("Failed to download files:", error);
                  alert("Failed to download files. Please try again.");
                }
              }}
              className="p-2 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
              title={`Download all files as zip (${files.length} file${files.length !== 1 ? "s" : ""})`}
            >
              <Download size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Terminal panel — below the controls bar, stays mounted once opened */}
      {terminalMounted && (
        <div className={`shrink-0 border-t border-black/10 dark:border-white/10 ${showTerminal ? "h-1/3" : "hidden"}`}>
          <BashEditor key="terminal" visible={showTerminal} />
        </div>
      )}
      {activeDrive && (
        <DrivePicker
          isOpen={!!activeDrive}
          onClose={() => setActiveDrive(null)}
          drive={activeDrive}
          onFilesSelected={handleDriveFiles}
          multiple
        />
      )}
    </div>
  );
}
