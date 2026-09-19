import { lazyRouteComponent } from "@tanstack/react-router";
import { Code, Download, Eye, File as FileIcon2, Loader2, Play, Shapes, Upload } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { useArtifactEntries, useArtifactFile } from "@/features/artifacts/hooks/useArtifactFiles";
import {
  artifactKind,
  artifactLanguage,
  processUploadedFile,
  type ProcessedFile,
} from "@/features/artifacts/lib/artifacts";
import type { ArtifactKind } from "@/features/artifacts/lib/artifacts";
import type { ArtifactRevisionListing, FileSystemManager } from "@/features/artifacts/lib/fs";
import { useChatActions } from "@/features/chat/hooks/useChat";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { DEFAULT_DRIVE_DOWNLOAD_MAX_BYTES, downloadDriveFile } from "@/shared/lib/drives";
import { notify } from "@/shared/lib/notify";
import { downloadBlob, getFileName } from "@/shared/lib/utils";
import { DriveIcon } from "@/shared/ui/DriveIcon";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import {
  DropdownMenu,
  DropdownMenuItem,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from "@/shared/ui/DropdownMenu";
import { ArtifactHistoryPopover } from "./ArtifactHistoryPopover";
import { ArtifactRevisionBanner } from "./ArtifactRevisionBanner";
import { ArtifactsBrowser } from "./ArtifactsBrowser";
import { ArtifactsNavigator } from "./ArtifactsNavigator";

// Editors are loaded on demand. Each pulls in heavy, format-specific
// dependencies (pdfjs, the docx/xlsx/pptx converters, mediabunny, shiki, …)
// that the chat view never needs until a user actually opens that file type.
// `lazyRouteComponent` is the same primitive the router uses — it also reloads
// gracefully when a chunk goes missing after a deploy.
const CodeEditor = lazyRouteComponent(() => import("@/shared/ui/editors/CodeEditor"), "CodeEditor");
const CsvEditor = lazyRouteComponent(() => import("@/shared/ui/editors/CsvEditor"), "CsvEditor");
const DocxEditor = lazyRouteComponent(() => import("@/shared/ui/editors/DocxEditor"), "DocxEditor");
const HtmlEditor = lazyRouteComponent(() => import("@/shared/ui/editors/HtmlEditor"), "HtmlEditor");
const JsEditor = lazyRouteComponent(() => import("@/shared/ui/editors/JsEditor"), "JsEditor");
const MarkdownEditor = lazyRouteComponent(
  () => import("@/shared/ui/editors/MarkdownEditor"),
  "MarkdownEditor",
);
const MediaEditor = lazyRouteComponent(
  () => import("@/shared/ui/editors/MediaEditor"),
  "MediaEditor",
);
const MermaidEditor = lazyRouteComponent(
  () => import("@/shared/ui/editors/MermaidEditor"),
  "MermaidEditor",
);
const OfficeMarkdownEditor = lazyRouteComponent(
  () => import("@/shared/ui/editors/OfficeMarkdownEditor"),
  "OfficeMarkdownEditor",
);
const PdfEditor = lazyRouteComponent(() => import("@/shared/ui/editors/PdfEditor"), "PdfEditor");
const PptxEditor = lazyRouteComponent(() => import("@/shared/ui/editors/PptxEditor"), "PptxEditor");
const PythonEditor = lazyRouteComponent(
  () => import("@/shared/ui/editors/PythonEditor"),
  "PythonEditor",
);
const SvgEditor = lazyRouteComponent(() => import("@/shared/ui/editors/SvgEditor"), "SvgEditor");
const TextEditor = lazyRouteComponent(() => import("@/shared/ui/editors/TextEditor"), "TextEditor");
const XlsxEditor = lazyRouteComponent(() => import("@/shared/ui/editors/XlsxEditor"), "XlsxEditor");

const ArtifactRevisionDiff = lazyRouteComponent(
  () => import("./ArtifactRevisionDiff"),
  "ArtifactRevisionDiff",
);

const WIDE_DRAWER_PX = 680;

/** File kinds whose revisions can be compared as a line diff. */
const DIFFABLE_KINDS = new Set<ArtifactKind>(["text", "code", "svg", "mermaid", "html", "csv", "markdown"]);

/** An archived revision loaded for display in place of the live file. */
interface RevisionView {
  fs: FileSystemManager;
  path: string;
  entry: ArtifactRevisionListing;
  content: string;
  contentType?: string;
}

export function ArtifactsDrawer() {
  const config = getConfig();
  const { fs, activeFile, openFile } = useArtifacts();
  const { ensureChat } = useChatActions();

  const [isDragOver, setIsDragOver] = useState(false);
  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [runner, setRunner] = useState<{
    fs: FileSystemManager | null;
    path: string | null;
    run: () => Promise<void>;
    isRunning: boolean;
  } | null>(null);
  const currentRunner = runner?.fs === fs && runner?.path === activeFile ? runner : null;
  const runHandler = currentRunner?.run;
  const isRunning = currentRunner?.isRunning ?? false;
  // The file tree gets its own column only when the drawer can hold it next to a
  // comfortable preview; below that it folds into the breadcrumb's popover.
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => setWide(root.clientWidth >= WIDE_DRAWER_PX);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const viewSliderRef = useRef<HTMLDivElement>(null);
  const [viewSliderStyle, setViewSliderStyle] = useState({ left: 0, width: 0 });
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const files = useArtifactEntries(fs);
  const activeFileData = useArtifactFile(fs, activeFile);

  // Archived revisions shown in place of the live file: a hover preview from
  // the history list and a pinned one with restore/compare actions.
  const [hoverRevision, setHoverRevision] = useState<RevisionView | null>(null);
  const [pinnedRevision, setPinnedRevision] = useState<RevisionView | null>(null);
  const [compareRevision, setCompareRevision] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState(false);
  const revisionRequest = useRef(0);

  const closeRevision = useCallback(() => {
    revisionRequest.current++;
    setHoverRevision(null);
    setPinnedRevision(null);
    setCompareRevision(false);
  }, []);

  // Another file, another workspace, or a change to the live file retires any
  // archived view so the banner never describes a stale "current".
  useEffect(() => {
    closeRevision();
    if (!fs || !activeFile) return;
    const retire = (changed: string) => {
      if (changed === activeFile) closeRevision();
    };
    const subscriptions = [
      fs.subscribe("fileUpdated", retire),
      fs.subscribe("fileDeleted", retire),
      fs.subscribe("fileRenamed", (from) => retire(from)),
    ];
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [fs, activeFile, closeRevision]);

  const loadRevision = useCallback(
    async (entry: ArtifactRevisionListing): Promise<RevisionView | null> => {
      if (!fs || !activeFile) return null;
      const file = await fs.readRevision(activeFile, entry.revision);
      return file
        ? { fs, path: activeFile, entry, content: file.content, contentType: file.contentType }
        : null;
    },
    [fs, activeFile],
  );

  const handlePeekRevision = useCallback(
    (entry: ArtifactRevisionListing | null) => {
      const request = ++revisionRequest.current;
      if (!entry || entry.current) {
        setHoverRevision(null);
        return;
      }
      loadRevision(entry)
        .then((view) => {
          if (request === revisionRequest.current) setHoverRevision(view);
        })
        .catch((error) => console.error("Error loading artifact revision:", error));
    },
    [loadRevision],
  );

  const handlePinRevision = useCallback(
    (entry: ArtifactRevisionListing) => {
      const request = ++revisionRequest.current;
      setHoverRevision(null);
      setCompareRevision(false);
      if (entry.current) {
        setPinnedRevision(null);
        return;
      }
      loadRevision(entry)
        .then((view) => {
          if (request === revisionRequest.current) setPinnedRevision(view);
        })
        .catch((error) => console.error("Error loading artifact revision:", error));
    },
    [loadRevision],
  );

  const restoreRevision = useCallback(async () => {
    if (!pinnedRevision) return;
    setRestoringRevision(true);
    try {
      await pinnedRevision.fs.restoreRevision(pinnedRevision.path, pinnedRevision.entry.revision);
      closeRevision();
    } catch (error) {
      console.error("Failed to restore revision:", error);
      notify.error(
        "Restore failed",
        error instanceof Error ? error.message : "The revision couldn't be restored.",
      );
    } finally {
      setRestoringRevision(false);
    }
  }, [pinnedRevision, closeRevision]);

  const shownRevision =
    [hoverRevision, pinnedRevision].find((view) => view && view.fs === fs && view.path === activeFile) ??
    null;
  const canCompareRevision =
    !!activeFileData && DIFFABLE_KINDS.has(artifactKind(activeFileData.path, activeFileData.contentType));

  // Processing state for file uploads
  const [pendingUploads, setPendingUploads] = useState(0);
  const isProcessing = pendingUploads > 0;

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
    async (source: globalThis.File[] | (() => Promise<globalThis.File[]>)) => {
      if (Array.isArray(source) && source.length === 0) return;
      setPendingUploads((count) => count + 1);
      try {
        const activeFs = await ensureFs();
        const fileList = typeof source === "function" ? await source() : source;
        const batch: ProcessedFile[] = [];
        for (const file of fileList) {
          batch.push(...(await processUploadedFile(file)));
        }
        const ingestion = await activeFs.ingestFiles(batch, {
          origin: { actor: "user", reason: "upload" },
        });
        const lastPath = ingestion.paths.at(-1);
        if (lastPath) openFile(lastPath, activeFs);
      } catch (error) {
        console.error("Error uploading files:", error);
        notify.error(
          "Upload failed",
          error instanceof Error
            ? error.message
            : "The files couldn't be added; the workspace was left unchanged.",
        );
      } finally {
        setPendingUploads((count) => count - 1);
      }
    },
    [ensureFs, openFile],
  );

  const handleDriveFiles = useCallback(
    (selected: SelectedFile[]) => {
      // Bind the upload's workspace before downloads can outlast navigation.
      return uploadFiles(async () => {
        const fetched: globalThis.File[] = [];
        for (const f of selected) {
          fetched.push(
            await downloadDriveFile(
              f,
              config.artifacts?.maxFileSize ?? DEFAULT_DRIVE_DOWNLOAD_MAX_BYTES,
            ),
          );
        }
        return fetched;
      });
    },
    [config.artifacts?.maxFileSize, uploadFiles],
  );

  // Callback for editors to register their run handler
  const onRunReady = useCallback(
    (handler: (() => Promise<void>) | null) => {
      setRunner((current) => {
        const ownsRunner = current?.fs === fs && current?.path === activeFile;
        if (!handler) return ownsRunner ? null : current;
        return { fs, path: activeFile, run: handler, isRunning: ownsRunner && current.isRunning };
      });
    },
    [fs, activeFile],
  );
  const onRunningChange = useCallback(
    (isRunning: boolean) => {
      setRunner((current) =>
        current?.fs === fs && current?.path === activeFile ? { ...current, isRunning } : current,
      );
    },
    [fs, activeFile],
  );

  // Download a single artifact by path, logging (not surfacing) failures.
  const downloadFile = useCallback(
    async (path: string) => {
      if (!fs) return;
      try {
        await fs.downloadFile(path);
      } catch (error) {
        console.error("Failed to download file:", error);
      }
    },
    [fs],
  );

  const downloadAll = useCallback(async () => {
    if (!fs) return;
    try {
      await fs.downloadAsZip();
    } catch (error) {
      console.error("Failed to download files:", error);
      notify.error("Download failed", "The files couldn't be downloaded. Please try again.");
    }
  }, [fs]);
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
      if (fs) openFile(best.path, fs);
    }
  }, [files, fs, openFile]);

  // Drag and drop handlers
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    // IMPORTANT: Capture files immediately before any async work!
    // The browser clears e.dataTransfer after the sync part of the handler completes
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      await uploadFiles(droppedFiles);
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

  // Render the file-specific editor
  const renderFileEditor = () => {
    if (!activeFile) {
      if (files.length > 0) {
        return (
          <div className="h-full flex items-center justify-center p-8">
            <p className="text-sm text-neutral-400 dark:text-neutral-500">
              Select a file from the sidebar
            </p>
          </div>
        );
      }
      return (
        <div className="h-full flex items-center justify-center p-6">
          <div className="w-full max-w-sm text-center">
            <Shapes size={28} className="text-neutral-300 dark:text-neutral-600 mb-3 mx-auto" />
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
              No artifacts yet
            </h3>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed mb-4">
              Drop files here or use Upload. Anything you create in the chat appears here too.
            </p>
            <ul className="space-y-1.5 text-left">
              {[
                "Make a chart from these numbers.",
                "Turn these notes into a polished document.",
                "Create a slide deck about this topic.",
              ].map((example) => (
                <li
                  key={example}
                  className="text-xs text-neutral-400 dark:text-neutral-500 italic bg-black/5 dark:bg-white/5 rounded-md px-3 py-2 leading-relaxed"
                >
                  &ldquo;{example}&rdquo;
                </li>
              ))}
            </ul>
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

    // A hovered or pinned revision replaces the live content in the same editor.
    const shownFile = shownRevision
      ? {
          ...activeFileData,
          content: shownRevision.content,
          contentType: shownRevision.contentType ?? activeFileData.contentType,
        }
      : activeFileData;
    const editorKey = JSON.stringify([
      fs?.chatId,
      shownFile.path,
      shownRevision?.entry.revision ?? "current",
    ]);
    const kind = artifactKind(shownFile.path, shownFile.contentType);

    switch (kind) {
      case "image":
        return (
          <div className="h-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-900/60 p-6 overflow-auto">
            <img
              key={editorKey}
              src={shownFile.content}
              alt={getFileName(shownFile.path)}
              className="max-w-full max-h-full object-contain rounded-md shadow-sm"
              draggable={false}
            />
          </div>
        );
      case "audio":
      case "video":
        return (
          <MediaEditor
            key={editorKey}
            path={shownFile.path}
            content={shownFile.content}
            contentType={shownFile.contentType}
          />
        );
      case "pdf":
        return <PdfEditor key={editorKey} content={shownFile.content} />;
      case "pptx":
        return (
          <PptxEditor
            key={editorKey}
            path={shownFile.path}
            content={shownFile.content}
            contentType={shownFile.contentType}
          />
        );
      case "docx":
        return (
          <DocxEditor
            key={editorKey}
            path={shownFile.path}
            content={shownFile.content}
            contentType={shownFile.contentType}
          />
        );
      case "xlsx":
        return (
          <XlsxEditor
            key={editorKey}
            path={shownFile.path}
            content={shownFile.content}
            contentType={shownFile.contentType}
          />
        );
      case "email":
        return (
          <OfficeMarkdownEditor
            key={editorKey}
            path={shownFile.path}
            content={shownFile.content}
            contentType={shownFile.contentType}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "binary":
        return (
          <div className="h-full flex items-center justify-center p-8">
            <div className="max-w-md text-center">
              <FileIcon2
                size={32}
                className="mx-auto mb-4 text-neutral-300 dark:text-neutral-600"
              />
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                Binary File
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                This file is stored as binary data and cannot be edited as plain text here.
              </p>
              <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                {shownFile.contentType || "application/octet-stream"}
              </p>
            </div>
          </div>
        );
      case "html":
        return (
          <HtmlEditor
            key={editorKey}
            path={shownFile.path}
            content={shownFile.content}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "svg":
        return (
          <SvgEditor
            key={editorKey}
            content={shownFile.content}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "mermaid":
        return (
          <MermaidEditor
            key={editorKey}
            content={shownFile.content}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "csv":
        return (
          <CsvEditor
            key={editorKey}
            content={shownFile.content}
            path={shownFile.path}
            contentType={shownFile.contentType}
            viewMode={viewMode === "preview" ? "table" : "code"}
            onViewModeChange={(mode) => setViewMode(mode === "table" ? "preview" : "code")}
          />
        );
      case "markdown":
        return (
          <MarkdownEditor
            key={editorKey}
            content={shownFile.content}
            path={shownFile.path}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        );
      case "code": {
        const lang = artifactLanguage(shownFile.path);
        if (lang === "py") {
          return (
            <PythonEditor
              key={editorKey}
              content={shownFile.content}
              onRunReady={onRunReady}
              onRunningChange={onRunningChange}
            />
          );
        }
        if (lang === "js") {
          return (
            <JsEditor
              key={editorKey}
              content={shownFile.content}
              onRunReady={onRunReady}
              onRunningChange={onRunningChange}
            />
          );
        }
        return <CodeEditor key={editorKey} content={shownFile.content} language={lang} />;
      }
      default:
        return <TextEditor key={editorKey} content={shownFile.content} />;
    }
  };

  // Update slider position whenever viewMode changes or the switcher mounts (activeFile change)
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
    return ["html", "svg", "mermaid", "csv", "markdown"].includes(kind);
  };

  // Handle run button click
  const handleRun = async () => {
    if (runHandler) {
      await runHandler();
    }
  };

  // No file open and nothing in the project — the empty state. The header shows
  // an "Artifacts" title + Upload action; the body shows the slim onboarding card.
  const isEmpty = !activeFile && files.length === 0;

  return (
    <div
      ref={rootRef}
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
            <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Drop files here
            </p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Files will be added to the project
            </p>
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

      {/* Left = top bar + editor; right = the file column when the drawer is wide */}
      <div className="flex flex-1 min-h-0">
        <div className="h-full flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Top bar — lives inside the left column so the file column spans the full drawer height */}
          <div className="@container shrink-0 h-12 md:h-10 flex items-center px-2 gap-1">
            {/* File title */}
            <div className="flex-1 flex items-center min-w-0 px-1 gap-1.5 relative">
              {isEmpty && (
                <span className="text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200 truncate">
                  Artifacts
                </span>
              )}
              {activeFile && fs && (
                <ArtifactsNavigator
                  fs={fs}
                  files={files}
                  activePath={activeFile}
                  onOpen={openFile}
                  popover={!wide && files.length > 1}
                  drives={config.drives}
                  isProcessing={isProcessing}
                  onUploadLocal={() => fileInputRef.current?.click()}
                  onUploadDrive={(drive) => setActiveDrive(drive)}
                  onDownloadAll={downloadAll}
                  onDownloadFile={downloadFile}
                />
              )}
              {/* The "Text preview" disclosure for extracted-text rendering
                  lives inside OfficeMarkdownEditor so it also covers the
                  fallback paths of the high-fidelity office editors. */}
            </div>

            {/* Empty-state Upload action — mirrors the Agent drawer's subtle header actions. */}
            {isEmpty &&
              (config.drives.length > 0 ? (
                <DropdownMenu
                  anchor="bottom end"
                  trigger={
                    <MenuButton className="shrink-0 flex items-center gap-1 mr-2 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">
                      <Upload size={12} />
                      <span className="@[16rem]:inline hidden">Upload</span>
                    </MenuButton>
                  }
                >
                  <DropdownMenuItem
                    icon={<Upload size={16} />}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload
                  </DropdownMenuItem>
                  {config.drives.map((drive) => (
                    <DropdownMenuItem
                      key={drive.id}
                      icon={<DriveIcon drive={drive} />}
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
                  className="shrink-0 flex items-center gap-1 mr-2 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                  title="Upload files"
                >
                  <Upload size={12} />
                  <span className="@[16rem]:inline hidden">Upload</span>
                </button>
              ))}

            {/* File-specific action group: run, view toggle, word export, download */}
            {(runHandler || activeFileData) && (
              <>
                <div className="flex items-center gap-0.5">
                      {/* Preview / code toggle, grouped with the other file actions */}
                  {supportsPreview() && (
                    <div
                      ref={viewSliderRef}
                      className="relative flex items-center gap-0.5 bg-neutral-200/50 dark:bg-neutral-800/50 backdrop-blur-sm rounded-full p-0.5 ring-1 ring-black/5 dark:ring-white/5 shrink-0 mr-1"
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
                        <Code
                          size={11}
                          strokeWidth={2.25}
                          className="w-3.5 h-3.5 md:w-2.75 md:h-2.75"
                        />
                      </button>
                    </div>
                  )}
                  {/* Revision history */}
                  {activeFileData && fs && (
                    <ArtifactHistoryPopover
                      fs={fs}
                      path={activeFileData.path}
                      onPeek={handlePeekRevision}
                      onPin={handlePinRevision}
                    />
                  )}
                  {/* Run button (the live file only; an archived revision is read-only) */}
                  {runHandler && !shownRevision && (
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
                      const isMarkdown =
                        artifactKind(activeFileData.path, activeFileData.contentType) ===
                        "markdown";
                      if (!isMarkdown) {
                        return (
                          <button
                            type="button"
                            onClick={() => downloadFile(activeFileData.path)}
                            className="p-2 md:p-1.5 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5"
                            title={`Download ${getFileName(activeFileData.path)}`}
                          >
                            <Download size={13} className="w-4 h-4 md:w-3.25 md:h-3.25" />
                          </button>
                        );
                      }
                      return (
                        <Menu>
                          <MenuButton
                            className="p-2 md:p-1.5 rounded transition-all duration-150 ease-out text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5"
                            title="Download"
                          >
                            <Download size={13} className="w-4 h-4 md:w-3.25 md:h-3.25" />
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
                                onClick={() => downloadFile(activeFileData.path)}
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
                                    const { markdownToDocx } =
                                      await import("@/shared/lib/markdownToDocx");
                                    const blob = await markdownToDocx(activeFileData.content);
                                    const baseName = getFileName(activeFileData.path).replace(
                                      /\.(md|markdown)$/i,
                                      "",
                                    );
                                    await downloadBlob(blob, `${baseName}.docx`);
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
              </>
            )}
          </div>

          {/* Editor fills the left column */}
          <div className="flex-1 min-h-0 overflow-hidden relative z-0 flex flex-col">
            {pinnedRevision && shownRevision === pinnedRevision && (
              <ArtifactRevisionBanner
                entry={pinnedRevision.entry}
                canCompare={canCompareRevision}
                comparing={compareRevision}
                restoring={restoringRevision}
                onToggleCompare={() => setCompareRevision((value) => !value)}
                onRestore={restoreRevision}
                onClose={closeRevision}
              />
            )}
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <Suspense
                fallback={
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-neutral-400 dark:text-neutral-500" />
                  </div>
                }
              >
                {compareRevision && pinnedRevision && activeFileData ? (
                  <ArtifactRevisionDiff before={pinnedRevision.content} after={activeFileData.content} />
                ) : (
                  renderFileEditor()
                )}
              </Suspense>
            </div>
          </div>
        </div>

        {wide && files.length > 0 && fs && (
          <ArtifactsBrowser
            key={fs.chatId}
            className="w-52 shrink-0"
            fs={fs}
            files={files}
            activePath={activeFile}
            onOpen={openFile}
            drives={config.drives}
            isProcessing={isProcessing}
            onUploadLocal={() => fileInputRef.current?.click()}
            onUploadDrive={(drive) => setActiveDrive(drive)}
            onDownloadAll={downloadAll}
            onDownloadFile={downloadFile}
          />
        )}
      </div>

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
