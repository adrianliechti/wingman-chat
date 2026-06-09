import {
  Check,
  ChevronDown,
  Code,
  Download,
  Eye,
  File as FileIcon2,
  Files,
  HardDrive,
  Loader2,
  PanelRightOpen,
  Play,
  Shapes,
  Terminal,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { artifactKind, artifactLanguage, processUploadedFile } from "@/features/artifacts/lib/artifacts";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { useChat } from "@/features/chat/hooks/useChat";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { getDriveContentUrl } from "@/shared/lib/drives";
import { markdownToDocx } from "@/shared/lib/markdownToDocx";
import { downloadBlob, getFileName } from "@/shared/lib/utils";
import type { File, FileEntry } from "@/shared/types/file";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { BashEditor } from "@/shared/ui/editors/BashEditor";
import { CodeEditor } from "@/shared/ui/editors/CodeEditor";
import { CsvEditor } from "@/shared/ui/editors/CsvEditor";
import { DocxEditor } from "@/shared/ui/editors/DocxEditor";
import { HtmlEditor } from "@/shared/ui/editors/HtmlEditor";
import { JsEditor } from "@/shared/ui/editors/JsEditor";
import { MarkdownEditor } from "@/shared/ui/editors/MarkdownEditor";
import { OfficeMarkdownEditor } from "@/shared/ui/editors/OfficeMarkdownEditor";
import { PdfEditor } from "@/shared/ui/editors/PdfEditor";
import { PptxEditor } from "@/shared/ui/editors/PptxEditor";
import { PythonEditor } from "@/shared/ui/editors/PythonEditor";
import { SvgEditor } from "@/shared/ui/editors/SvgEditor";
import { TextEditor } from "@/shared/ui/editors/TextEditor";
import { XlsxEditor } from "@/shared/ui/editors/XlsxEditor";
import { FileIcon } from "@/shared/ui/FileIcon";
import { ResizablePanel, ResizablePanelGroup } from "@/shared/ui/Resizable";
import { ArtifactsBrowser } from "./ArtifactsBrowser";

export function ArtifactsDrawer() {
  const config = getConfig();
  const { fs, activeFile, openFile } = useArtifacts();
  const { chat, ensureChat } = useChat();

  const [isDragOver, setIsDragOver] = useState(false);
  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [isRunning, setIsRunning] = useState(false);
  const [runHandler, setRunHandler] = useState<(() => Promise<void>) | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const filePickerRef = useRef<HTMLDivElement>(null);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [showFilesBrowser, setShowFilesBrowser] = useState(false);
  const viewSliderRef = useRef<HTMLDivElement>(null);
  const [viewSliderStyle, setViewSliderStyle] = useState({ left: 0, width: 0 });
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State for files list (loaded from async fs.listFiles)
  const [files, setFiles] = useState<FileEntry[]>([]);

  // State for active file content (loaded from async fs.getFile)
  const [activeFileData, setActiveFileData] = useState<File | null>(null);

  // Processing state for file uploads
  const [isProcessing, setIsProcessing] = useState(false);

  // Ensure a chat exists and return its `FileSystemManager`. Delegates to the
  // chat feature so artifacts has no chat-creation logic of its own. Using
  // the returned `fs` directly avoids observing a stale (null) `fs` from
  // the current closure before React re-renders.
  const ensureFs = useCallback(async (): Promise<FileSystemManager> => {
    if (fs) return fs;
    const ensured = await ensureChat();
    return ensured.fs;
  }, [fs, ensureChat]);

  const uploadFiles = useCallback(
    async (fileList: globalThis.File[]) => {
      const activeFs = await ensureFs();
      setIsProcessing(true);
      try {
        for (const file of fileList) {
          try {
            const processedFiles = await processUploadedFile(file);
            for (const processed of processedFiles) {
              await activeFs.createFile(processed.path, processed.content, processed.contentType);
              openFile(processed.path);
            }
          } catch (error) {
            console.error(`Error uploading file ${file.name}:`, error);
          }
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [ensureFs, openFile],
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
    if (!fs) {
      setFiles([]);
      setActiveFileData(null);
      return;
    }

    let cancelled = false;

    // Helper to load files list
    const loadFiles = async () => {
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
      if (!activeFile) {
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
  }, [fs, activeFile]);

  // Handle auto-opening a file when none is active but files are available.
  // Prefers the most recently modified file; falls back to alphabetical first.
  // Only re-run when the `files` list changes — not when `activeFile` toggles.
  // Otherwise a deletion flow races: clearing `activeFile` re-runs this effect
  // before `loadFiles()` finishes, so `files` is still stale with the deleted
  // entry and we'd immediately reopen it.
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  useEffect(() => {
    if (!activeFileRef.current && files.length > 0) {
      const best = files.reduce((prev, curr) => {
        const prevTime = prev.lastModified ?? 0;
        const currTime = curr.lastModified ?? 0;
        if (currTime !== prevTime) return currTime > prevTime ? curr : prev;
        return curr.path < prev.path ? curr : prev;
      });
      openFile(best.path);
    }
  }, [files, openFile]);

  // Drag and drop handlers
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    // IMPORTANT: Capture files immediately before any async work!
    // The browser clears e.dataTransfer after the sync part of the handler completes
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) {
      return;
    }

    // Ensure a chat and FS exist before writing files
    const activeFs = await ensureFs();

    setIsProcessing(true);
    try {
      for (const file of droppedFiles) {
        try {
          // Process file (converts XLSX to CSV automatically)
          const processedFiles = await processUploadedFile(file);

          for (const processed of processedFiles) {
            await activeFs.createFile(processed.path, processed.content, processed.contentType);
            openFile(processed.path);
          }
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
        }
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Close file picker when clicking outside
  useEffect(() => {
    if (!showFilePicker) return;
    const handleClick = (e: MouseEvent) => {
      if (!filePickerRef.current?.contains(e.target as Node)) {
        setShowFilePicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showFilePicker]);

  // Render the file-specific editor
  const renderFileEditor = () => {
    if (!activeFile) {
      if (files.length > 0) {
        return (
          <div className="h-full flex items-center justify-center p-8">
            <p className="text-sm text-neutral-400 dark:text-neutral-500">Select a file from the sidebar</p>
          </div>
        );
      }
      return (
        <div className="h-full flex items-center justify-center p-8">
          <div className="w-full max-w-sm text-center">
            <Shapes size={28} className="text-neutral-300 dark:text-neutral-600 mb-3 mx-auto" />
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-1">No artifacts yet</h3>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed mb-4">
              Files, code, and documents created in the conversation will appear here. You can also run Python or shell
              commands directly.
            </p>
            <ul className="space-y-1.5 text-left mb-5">
              {[
                "Analyze this CSV and create a chart.",
                "Write a Python script to clean up this spreadsheet.",
                "Turn these notes into a polished document.",
              ].map((example) => (
                <li
                  key={example}
                  className="text-xs text-neutral-400 dark:text-neutral-500 italic bg-black/5 dark:bg-white/5 rounded-md px-3 py-2 leading-relaxed"
                >
                  &ldquo;{example}&rdquo;
                </li>
              ))}
            </ul>
            {config.drives.length > 0 ? (
              <DropdownMenu
                anchor="bottom"
                trigger={
                  <MenuButton className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors">
                    <Upload size={13} className="shrink-0" />
                    Upload files
                  </MenuButton>
                }
              >
                <DropdownMenuItem icon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>
                  Upload
                </DropdownMenuItem>
                {config.drives.map((drive) => (
                  <DropdownMenuItem
                    key={drive.id}
                    icon={
                      drive.icon ? (
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
                      )
                    }
                    onClick={() => setActiveDrive(drive)}
                  >
                    {drive.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
              >
                <Upload size={13} className="shrink-0" />
                Upload files
              </button>
            )}
            <p className="mt-3 text-xs text-neutral-300 dark:text-neutral-600">or drag &amp; drop anywhere</p>
          </div>
        </div>
      );
    }

    // While a file switch is in flight, `activeFileData` still holds the
    // previous file's content. Don't render it — it causes a visible flash
    // of the old editor with mismatched `key` before the async load lands.
    if (!activeFileData || activeFileData.path !== activeFile) {
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
      case "pdf":
        return <PdfEditor key={editorKey} content={activeFileData.content} />;
      case "pptx":
        return (
          <PptxEditor
            key={editorKey}
            path={activeFileData.path}
            content={activeFileData.content}
            contentType={activeFileData.contentType}
          />
        );
      case "docx":
        return (
          <DocxEditor
            key={editorKey}
            path={activeFileData.path}
            content={activeFileData.content}
            contentType={activeFileData.contentType}
          />
        );
      case "xlsx":
        return (
          <XlsxEditor
            key={editorKey}
            path={activeFileData.path}
            content={activeFileData.content}
            contentType={activeFileData.contentType}
          />
        );
      case "email":
        return (
          <OfficeMarkdownEditor
            key={editorKey}
            path={activeFileData.path}
            content={activeFileData.content}
            contentType={activeFileData.contentType}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "binary":
        return (
          <div className="h-full flex items-center justify-center p-8">
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
            path={activeFileData.path}
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

  // Update slider position whenever viewMode changes or the switcher mounts (activeFile change)
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeFile triggers remeasurement when preview/code buttons appear or disappear
  useEffect(() => {
    const measure = () => {
      const container = viewSliderRef.current;
      if (!container) return;
      const active = container.querySelector<HTMLElement>(`[data-view="${viewMode}"]`);
      if (!active) return;
      const cr = container.getBoundingClientRect();
      const br = active.getBoundingClientRect();
      setViewSliderStyle({ left: br.left - cr.left, width: br.width });
    };
    // Run immediately, then also after a paint in case the container just mounted
    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [viewMode, activeFile]);

  // Check if current file supports preview mode.
  // Office binaries are deliberately excluded — their "code" view is the
  // derived markdown, which isn't useful to inspect or edit.
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
      className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200 relative pt-2 md:pt-0 bg-neutral-50 dark:bg-neutral-950"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
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

      {/* Outer horizontal split: left = top bar + editor + terminal; right = files browser (full height) */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* Left column: top bar + vertical editor/terminal split */}
        <ResizablePanel defaultSize={75} minSize={200} className="h-full flex flex-col overflow-hidden">
          {/* Top bar — lives inside the left column so the files browser spans full drawer height */}
          <div className="@container shrink-0 h-12 md:h-10 flex items-center px-2 gap-1">
            {/* File title */}
            <div className="flex-1 flex items-center min-w-0 px-1 gap-1.5 relative" ref={filePickerRef}>
              {activeFile && (
                <button
                  type="button"
                  onClick={() => files.length > 1 && setShowFilePicker((v) => !v)}
                  className={cn(
                    "flex items-center gap-1.5 min-w-0 rounded px-1 -mx-1 py-0.5 transition-all duration-150 ease-out",
                    files.length > 1
                      ? "hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                      : "cursor-default pointer-events-none",
                  )}
                >
                  <FileIcon name={activeFile} className="shrink-0 @[18rem]:inline hidden" />
                  <span
                    className="text-sm md:text-xs font-medium truncate text-neutral-600 dark:text-neutral-400"
                    title={getFileName(activeFile)}
                  >
                    {getFileName(activeFile)}
                  </span>
                  {files.length > 1 && (
                    <ChevronDown
                      size={12}
                      className={cn(
                        "shrink-0 w-3.5 h-3.5 md:w-3 md:h-3 text-neutral-400 transition-transform duration-150",
                        showFilePicker && "rotate-180",
                      )}
                    />
                  )}
                </button>
              )}
              {/* The "Text preview" disclosure for extracted-text rendering
                  lives inside OfficeMarkdownEditor so it also covers the
                  fallback paths of the high-fidelity office editors. */}
              {/* View mode segmented control — inline after filename */}
              {supportsPreview() && (
                <div
                  ref={viewSliderRef}
                  className="relative flex items-center gap-0.5 bg-neutral-200/50 dark:bg-neutral-800/50 backdrop-blur-sm rounded-full p-0.5 ring-1 ring-black/5 dark:ring-white/5 shrink-0 ml-2"
                >
                  {/* responsive segmented control */}
                  {/* Animated slider background */}
                  {viewSliderStyle.width > 0 && (
                    <div
                      className="absolute bg-white dark:bg-neutral-950 rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10 transition-[left,width] duration-300 ease-out"
                      style={{
                        left: `${viewSliderStyle.left}px`,
                        width: `${viewSliderStyle.width}px`,
                        height: "calc(100% - 4px)",
                        top: "2px",
                      }}
                    />
                  )}
                  <button
                    type="button"
                    data-view="preview"
                    onClick={() => setViewMode("preview")}
                    title="Preview"
                    className={cn(
                      "relative z-10 flex items-center justify-center w-6 h-6 md:w-5 md:h-5 rounded-full transition-colors duration-200 text-xs",
                      viewMode === "preview"
                        ? "text-neutral-900 dark:text-neutral-50"
                        : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
                    )}
                  >
                    <Eye size={11} strokeWidth={2.25} className="w-3.5 h-3.5 md:w-2.75 md:h-2.75" />
                  </button>
                  <button
                    type="button"
                    data-view="code"
                    onClick={() => setViewMode("code")}
                    title="Code"
                    className={cn(
                      "relative z-10 flex items-center justify-center w-6 h-6 md:w-5 md:h-5 rounded-full transition-colors duration-200 text-xs",
                      viewMode === "code"
                        ? "text-neutral-900 dark:text-neutral-50"
                        : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
                    )}
                  >
                    <Code size={11} strokeWidth={2.25} className="w-3.5 h-3.5 md:w-2.75 md:h-2.75" />
                  </button>
                </div>
              )}
              {showFilePicker && files.length > 1 && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-48 max-w-72 rounded-xl border border-white/40 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-lg shadow-black/20 dark:shadow-black/50 overflow-hidden p-1">
                  {files.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => {
                        openFile(f.path);
                        setShowFilePicker(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-lg text-left text-sm md:text-xs transition-colors duration-100 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/60 dark:hover:bg-white/5",
                        f.path === activeFile && "font-medium",
                      )}
                    >
                      <FileIcon name={f.path} className="shrink-0" />
                      <span className="truncate" title={f.path}>
                        {getFileName(f.path)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* File-specific action group: run, view toggle, word export, download */}
            {(runHandler || activeFileData) && (
              <>
                <div className="flex items-center gap-0.5">
                  {/* Run button */}
                  {runHandler && (
                    <button
                      type="button"
                      onClick={handleRun}
                      disabled={isRunning}
                      className="p-2 md:p-1.5 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                      title={isRunning ? "Running..." : "Run"}
                    >
                      {isRunning ? (
                        <Loader2 size={14} className="w-4 h-4 md:w-3.5 md:h-3.5 animate-spin" />
                      ) : (
                        <Play size={14} className="w-4 h-4 md:w-3.5 md:h-3.5" />
                      )}
                    </button>
                  )}

                  {/* Download dropdown */}
                  {activeFileData &&
                    fs &&
                    (() => {
                      const isMarkdown = artifactKind(activeFileData.path, activeFileData.contentType) === "markdown";
                      if (!isMarkdown) {
                        return (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await fs.downloadFile(activeFileData.path);
                              } catch (error) {
                                console.error("Failed to download file:", error);
                              }
                            }}
                            className="flex items-center gap-1 px-2 py-1.5 md:px-1.5 md:py-1 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 text-sm md:text-xs"
                            title={`Download ${getFileName(activeFileData.path)}`}
                          >
                            <Download size={13} className="w-4 h-4 md:w-3.25 md:h-3.25" />
                            <span className="@[18rem]:inline hidden">Download</span>
                          </button>
                        );
                      }
                      return (
                        <Menu>
                          <MenuButton
                            className="flex items-center gap-1 px-2 py-1.5 md:px-1.5 md:py-1 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 text-sm md:text-xs"
                            title="Download"
                          >
                            <Download size={13} className="w-4 h-4 md:w-3.25 md:h-3.25" />
                            <span className="@[18rem]:inline hidden">Download</span>
                          </MenuButton>
                          <MenuItems
                            modal={false}
                            transition
                            anchor="bottom end"
                            className="mt-1 origin-top-right rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-lg py-1 z-50 min-w-44 transition duration-100 ease-out data-closed:scale-95 data-closed:opacity-0"
                          >
                            <MenuItem>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await fs.downloadFile(activeFileData.path);
                                  } catch (error) {
                                    console.error("Failed to download file:", error);
                                  }
                                }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 transition-colors"
                              >
                                <Download size={12} className="text-neutral-500" />
                                Download
                              </button>
                            </MenuItem>
                            <MenuItem>
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
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 transition-colors"
                              >
                                <img
                                  src="/icons/file-word.svg"
                                  alt="Word"
                                  width={12}
                                  height={12}
                                  className="dark:invert"
                                />
                                Download as Word
                              </button>
                            </MenuItem>
                          </MenuItems>
                        </Menu>
                      );
                    })()}
                </div>

                {chat?.id && <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />}
              </>
            )}

            {chat?.id && (
              <DropdownMenu
                anchor="bottom end"
                trigger={
                  <MenuButton
                    className="flex items-center gap-0.5 p-2 md:p-1.5 rounded transition-all duration-150 ease-out text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5"
                    title="Toggle panels"
                  >
                    <PanelRightOpen size={14} className="w-4 h-4 md:w-3.5 md:h-3.5" />
                    <ChevronDown size={10} className="w-3 h-3 md:w-2.5 md:h-2.5 opacity-60" />
                  </MenuButton>
                }
              >
                {files.length > 0 && (
                  <DropdownMenuItem
                    icon={<Files size={12} />}
                    selected={showFilesBrowser}
                    onClick={() => setShowFilesBrowser((v) => !v)}
                  >
                    Files
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem icon={<Terminal size={12} />} selected={showTerminal} onClick={toggleTerminal}>
                  Terminal
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>

          {/* Vertical split: editor on top, terminal on bottom */}
          <ResizablePanelGroup orientation="vertical" className="flex-1 min-h-0">
            <ResizablePanel defaultSize={70} minSize={20} className="h-full overflow-hidden relative z-0">
              {renderFileEditor()}
            </ResizablePanel>

            {/* Terminal — spans only the left column, below the editor */}
            {terminalMounted && showTerminal && (
              <ResizablePanel defaultSize={30} minSize={80}>
                <div className="h-full relative z-10 border-t border-black/10 dark:border-white/10 shadow-[0_-8px_20px_-2px_rgba(0,0,0,0.12)] dark:shadow-[0_-8px_20px_-2px_rgba(0,0,0,0.5)]">
                  <BashEditor key="terminal" visible={showTerminal} />
                </div>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>

          {/* Keep terminal mounted but hidden when closed */}
          {terminalMounted && !showTerminal && (
            <div className="hidden">
              <BashEditor key="terminal" visible={false} />
            </div>
          )}
        </ResizablePanel>

        {/* Files browser — right panel spanning full drawer height (including header and over terminal) */}
        {files.length > 0 && fs && showFilesBrowser && (
          <ResizablePanel defaultSize={25} minSize={120}>
            <div className="h-full overflow-hidden border-l border-black/10 dark:border-white/10">
              <ArtifactsBrowser
                fs={fs}
                files={files}
                openTabs={activeFile ? [activeFile] : []}
                onFileClick={openFile}
                drives={config.drives}
                isProcessing={isProcessing}
                onUploadLocal={() => fileInputRef.current?.click()}
                onUploadDrive={(drive) => setActiveDrive(drive)}
                onDownloadAll={async () => {
                  try {
                    await fs.downloadAsZip();
                  } catch (error) {
                    console.error("Failed to download files:", error);
                    alert("Failed to download files. Please try again.");
                  }
                }}
                onDownloadFile={async (path) => {
                  try {
                    await fs.downloadFile(path);
                  } catch (error) {
                    console.error("Failed to download file:", error);
                  }
                }}
              />
            </div>
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

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
