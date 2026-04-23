import { Dialog, Transition } from "@headlessui/react";
import {
  ArrowRight,
  Download,
  FileText,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Link,
  Loader2,
  Mic,
  Plus,
  Search,
  Type,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "@/shared/config";
import { useDropZone } from "@/shared/hooks/useDropZone";
import { acceptTypes } from "@/shared/lib/convert";
import { getDriveContentUrl } from "@/shared/lib/drives";
import { downloadFromUrl } from "@/shared/lib/utils";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { Markdown } from "@/shared/ui/Markdown";
import type { File } from "@/shared/types/file";
import { FieldRecorderOverlay } from "./FieldRecorderOverlay";

interface SourcesPanelProps {
  sources: File[];
  isSearching: boolean;
  searchWeb: (query: string, mode: "web" | "research") => Promise<string>;
  addSearchResult: (query: string, mode: "web" | "research", content: string) => Promise<void>;
  scrapeWeb: (url: string) => Promise<string>;
  addScrapeResult: (url: string, content: string) => Promise<void>;
  onFileAdd: (file: globalThis.File) => Promise<void>;
  onTextAdd: (name: string, text: string, audioUrl?: string) => Promise<string>;
  onDeleteSource: (sourceId: string) => void;
}

export function SourcesPanel({
  sources,
  isSearching,
  searchWeb,
  addSearchResult,
  scrapeWeb,
  addScrapeResult,
  onFileAdd,
  onTextAdd,
  onDeleteSource,
}: SourcesPanelProps) {
  const config = getConfig();
  const acceptFilter = acceptTypes().join(",");
  const [extracting, setExtracting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [showScrapeOverlay, setShowScrapeOverlay] = useState(false);
  const [showTextOverlay, setShowTextOverlay] = useState(false);
  const [showRecordOverlay, setShowRecordOverlay] = useState(false);
  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: globalThis.File[]) => {
      for (const file of files) {
        const fileId = file.name;
        setExtracting((prev) => new Set([...prev, fileId]));
        try {
          await onFileAdd(file);
        } catch (err) {
          setError(`Failed to add ${file.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
        } finally {
          setExtracting((prev) => {
            const next = new Set(prev);
            next.delete(fileId);
            return next;
          });
        }
      }
    },
    [onFileAdd],
  );

  const handleDriveFiles = useCallback(
    async (files: SelectedFile[]) => {
      for (const f of files) {
        setExtracting((prev) => new Set([...prev, f.name]));
        try {
          const url = getDriveContentUrl(f.driveId, f.id);
          const resp = await fetch(url);
          if (!resp.ok) {
            setError(`Failed to fetch ${f.name}: ${resp.statusText}`);
            continue;
          }
          const blob = await resp.blob();
          const type = f.mime || blob.type || "";
          const file = new globalThis.File([blob], f.name, { type });
          // handleFiles also adds to extracting, so remove our entry first
          setExtracting((prev) => {
            const next = new Set(prev);
            next.delete(f.name);
            return next;
          });
          await handleFiles([file]);
        } catch (err) {
          setError(`Failed to add ${f.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
          setExtracting((prev) => {
            const next = new Set(prev);
            next.delete(f.name);
            return next;
          });
        }
      }
    },
    [handleFiles],
  );

  const isDragging = useDropZone(containerRef, handleFiles);

  return (
    <div ref={containerRef} className="h-full flex flex-col relative">
      {/* Error */}
      {error && (
        <div className="px-3 pt-2">
          <div className="flex items-start gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Sources list */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-3 min-h-0">
        {(sources.length > 0 || extracting.size > 0 || isSearching) && (
          <div className="space-y-1">
            {/* Extracting indicators */}
            {Array.from(extracting).map((fileId) => (
              <div key={fileId} className="flex items-center gap-2 px-3 py-2 animate-pulse">
                <Loader2 size={14} className="text-neutral-400 animate-spin shrink-0" />
                <span className="text-xs text-neutral-500 truncate">{fileId}</span>
              </div>
            ))}

            {/* Source items */}
            {sources.map((source) => (
              <SourceItem key={source.path} source={source} onDelete={() => onDeleteSource(source.path)} />
            ))}
          </div>
        )}
      </div>

      {/* Bottom: Add sources dropdown */}
      <div className="px-3 pt-3 pb-5 relative">
        <button
          type="button"
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg text-neutral-600 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
        >
          <Plus size={16} />
          Add sources
        </button>

        {showAddMenu && (
          <>
            <button
              type="button"
              aria-label="Close add sources menu"
              className="fixed inset-0 z-40"
              onClick={() => setShowAddMenu(false)}
            />
            <div className="absolute bottom-full left-3 right-3 mb-1 z-50 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1">
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(false);
                  setShowTextOverlay(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <Type size={15} className="text-neutral-500" />
                Text
              </button>
              {config.stt && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddMenu(false);
                    setShowRecordOverlay(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <Mic size={15} className="text-neutral-500" />
                  Record
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(false);
                  fileInputRef.current?.click();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <Upload size={15} className="text-neutral-500" />
                Upload
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(false);
                  setShowScrapeOverlay(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <Link size={15} className="text-neutral-500" />
                Web Page
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(false);
                  setShowSearchOverlay(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <Globe size={15} className="text-neutral-500" />
                Web Search
              </button>
              {config.drives.map((drive) => (
                <button
                  key={drive.id}
                  type="button"
                  onClick={() => {
                    setShowAddMenu(false);
                    setActiveDrive(drive);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <HardDrive size={15} className="text-neutral-500" />
                  {drive.name}
                </button>
              ))}
            </div>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptFilter}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              handleFiles(Array.from(e.target.files));
              e.target.value = "";
            }
          }}
        />
      </div>

      {/* Drop zone overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-neutral-500/10 border-2 border-dashed border-neutral-400 dark:border-neutral-500 rounded-lg flex items-center justify-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <Upload size={24} className="text-neutral-500" />
            <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Drop files to add as sources
            </span>
          </div>
        </div>
      )}

      {/* Web Search Overlay */}
      {showSearchOverlay && (
        <WebSearchOverlay
          isSearching={isSearching}
          searchWeb={searchWeb}
          onAdd={async (query, mode, content) => {
            setError(null);
            try {
              await addSearchResult(query, mode, content);
              setShowSearchOverlay(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to add search result");
            }
          }}
          onClose={() => setShowSearchOverlay(false)}
        />
      )}

      {/* Web Page URL Overlay */}
      {showScrapeOverlay && (
        <WebScrapeOverlay
          isLoading={isSearching}
          scrapeWeb={scrapeWeb}
          onAdd={async (url, content) => {
            setError(null);
            try {
              await addScrapeResult(url, content);
              setShowScrapeOverlay(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to add page");
            }
          }}
          onClose={() => setShowScrapeOverlay(false)}
        />
      )}

      {/* Text Input Overlay */}
      {showTextOverlay && (
        <TextInputOverlay
          onAdd={async (name, text) => {
            setError(null);
            try {
              await onTextAdd(name, text);
              setShowTextOverlay(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to add text");
            }
          }}
          onClose={() => setShowTextOverlay(false)}
        />
      )}

      {/* Field Recorder */}
      {showRecordOverlay && (
        <FieldRecorderOverlay
          onSave={async (transcript, audioUrl) => {
            setError(null);
            try {
              await onTextAdd("Field Recording", transcript, audioUrl);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to add recording");
              throw err;
            }
          }}
          onClose={() => setShowRecordOverlay(false)}
        />
      )}

      {/* Drive Picker */}
      {activeDrive && (
        <DrivePicker
          isOpen={!!activeDrive}
          onClose={() => setActiveDrive(null)}
          drive={activeDrive}
          onFilesSelected={handleDriveFiles}
          multiple
          accept={acceptFilter}
        />
      )}
    </div>
  );
}

// ── Web Search Overlay ─────────────────────────────────────────────────

function WebSearchOverlay({
  isSearching,
  searchWeb,
  onAdd,
  onClose,
}: {
  isSearching: boolean;
  searchWeb: (query: string, mode: "web" | "research") => Promise<string>;
  onAdd: (query: string, mode: "web" | "research", content: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"web" | "research">("web");
  const [preview, setPreview] = useState("");
  const [previewQuery, setPreviewQuery] = useState("");
  const [previewMode, setPreviewMode] = useState<"web" | "research">("web");
  const queryInputRef = useRef<HTMLInputElement>(null);

  const modes = {
    web: { label: "Search", icon: Globe, hint: "Quick web search" },
    research: { label: "Deep Research", icon: Zap, hint: "Deep research with synthesis" },
  };

  useEffect(() => {
    queryInputRef.current?.focus();
  }, []);

  const handleSearch = async () => {
    if (!query.trim() || isSearching) return;
    const nextQuery = query.trim();
    const content = await searchWeb(nextQuery, mode);
    setPreview(content);
    setPreviewQuery(nextQuery);
    setPreviewMode(mode);
  };

  const handleAdd = () => {
    if (!preview || previewQuery !== query.trim() || previewMode !== mode || isSearching) return;
    onAdd(previewQuery, previewMode, preview);
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close web search"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Search the web</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <X size={16} className="text-neutral-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-neutral-50 dark:bg-neutral-800/60 rounded-lg border border-neutral-200 dark:border-neutral-700 focus-within:border-neutral-400 dark:focus-within:border-neutral-500 transition-colors">
            <Search size={16} className="text-neutral-400 shrink-0" />
            <input
              ref={queryInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="What are you looking for?"
              disabled={isSearching}
              className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none min-w-0"
            />
          </div>

          {/* Mode selector */}
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-0.5 p-0.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full">
              {(Object.keys(modes) as Array<"web" | "research">).map((m) => {
                const Icon = modes[m].icon;
                const isActive = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full transition-colors ${
                      isActive
                        ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm"
                        : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    }`}
                  >
                    <Icon size={12} />
                    {modes[m].label}
                  </button>
                );
              })}
            </div>

            <span className="text-xs text-neutral-400 flex-1 truncate">{modes[mode].hint}</span>
          </div>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/40 min-h-48 max-h-72 overflow-y-auto">
            {preview ? (
              <div className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300">
                <Markdown>{preview}</Markdown>
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-neutral-400 dark:text-neutral-500">
                Search results preview will appear here.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          {preview && previewQuery === query.trim() && previewMode === mode ? (
            <button
              type="button"
              onClick={handleAdd}
              disabled={isSearching}
              className="flex items-center gap-2 px-4 py-1.5 text-sm bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Add
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSearch}
              disabled={!query.trim() || isSearching}
              className="flex items-center gap-2 px-4 py-1.5 text-sm bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {isSearching ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  Search
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Web Scrape Overlay ────────────────────────────────────────────────

function WebScrapeOverlay({
  isLoading,
  scrapeWeb,
  onAdd,
  onClose,
}: {
  isLoading: boolean;
  scrapeWeb: (url: string) => Promise<string>;
  onAdd: (url: string, content: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    urlInputRef.current?.focus();
  }, []);

  const handleFetch = async () => {
    if (!url.trim() || isLoading) return;
    const nextUrl = url.trim();
    const content = await scrapeWeb(nextUrl);
    setPreview(content);
    setPreviewUrl(nextUrl);
  };

  const handleAdd = () => {
    if (!preview || previewUrl !== url.trim() || isLoading) return;
    onAdd(previewUrl, preview);
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close web page overlay"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Add web page</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <X size={16} className="text-neutral-500" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-neutral-50 dark:bg-neutral-800/60 rounded-lg border border-neutral-200 dark:border-neutral-700 focus-within:border-neutral-400 dark:focus-within:border-neutral-500 transition-colors">
            <Link size={16} className="text-neutral-400 shrink-0" />
            <input
              ref={urlInputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleFetch();
                }
              }}
              placeholder="https://example.com"
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none min-w-0"
            />
          </div>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/40 min-h-48 max-h-72 overflow-y-auto">
            {preview ? (
              <div className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300">
                <Markdown>{preview}</Markdown>
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-neutral-400 dark:text-neutral-500">
                Page content preview will appear here.
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          {preview && previewUrl === url.trim() ? (
            <button
              type="button"
              onClick={handleAdd}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-1.5 text-sm bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Add
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFetch}
              disabled={!url.trim() || isLoading}
              className="flex items-center gap-2 px-4 py-1.5 text-sm bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {isLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  Fetch
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Text Input Overlay ──────────────────────────────────────────────────

function TextInputOverlay({ onAdd, onClose }: { onAdd: (name: string, text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");

  return (
    <Transition appear show as={Fragment}>
      <Dialog as="div" className="relative z-80" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-lg rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl border border-neutral-200/50 dark:border-neutral-700/50 transition-all">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 dark:border-neutral-800/60">
                  <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Text Input
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Content */}
                <div className="px-5 py-3.5">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste or type text here..."
                    rows={10}
                    autoFocus
                    className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-y transition-colors"
                  />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30 rounded-b-xl">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdd("Pasted text", text.trim())}
                    disabled={!text.trim()}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Add
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

// ── Source Item ─────────────────────────────────────────────────────────

function sourceIcon(source: File) {
  if (source.contentType?.startsWith("audio/")) return Mic;
  if (source.contentType?.startsWith("image/")) return ImageIcon;
  if (/^https?:\/\//i.test(source.path)) return Globe;
  return FileText;
}

function isBinarySource(source: File): boolean {
  return typeof source.content === "string" && source.content.startsWith("data:");
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function SourceItem({ source, onDelete }: { source: File; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = sourceIcon(source);
  const binary = isBinarySource(source);
  const isAudio = source.contentType?.startsWith("audio/") ?? false;
  const isImage = source.contentType?.startsWith("image/") ?? false;

  return (
    <div className="group/source">
      <div className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
            <Icon size={12} className="text-neutral-500" />
          </div>
          <span
            className="flex-1 truncate text-xs text-neutral-700 dark:text-neutral-300"
            title={source.path}
          >
            {source.path}
          </span>
        </button>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/source:opacity-100 transition-opacity">
          {binary && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadFromUrl(source.content, basename(source.path));
              }}
              className="p-1 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
            >
              <Download size={12} className="text-neutral-400" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
          >
            <X size={12} className="text-neutral-400" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ml-8.5 mr-2 mb-1 px-2.5 py-2 rounded-md bg-neutral-50 dark:bg-neutral-800/40 max-h-64 overflow-y-auto">
          {isAudio ? (
            // biome-ignore lint/a11y/useMediaCaption: user-recorded audio, no captions available
            <audio controls className="w-full" src={source.content} />
          ) : isImage ? (
            <img src={source.content} alt={source.path} className="max-w-full max-h-60 rounded" />
          ) : (
            <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap">
              {binary
                ? `(${source.contentType ?? "binary"} content)`
                : `${source.content.slice(0, 2000)}${source.content.length > 2000 ? "..." : ""}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
