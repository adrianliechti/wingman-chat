import { useState, useRef, useCallback } from 'react';
import {
  Plus,
  Globe,
  FileText,
  X,
  Loader2,
  Upload,
  File,
  Search,
  Zap,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';
import { useDropZone } from '@/shared/hooks/useDropZone';
import type { ResearchSource } from '../types/research';

interface SourcesPanelProps {
  sources: ResearchSource[];
  isSearching: boolean;
  onWebSearch: (query: string, mode: 'web' | 'research') => Promise<void>;
  onFileAdd: (file: File) => Promise<void>;
  onDeleteSource: (sourceId: string) => void;
}

export function SourcesPanel({
  sources,
  isSearching,
  onWebSearch,
  onFileAdd,
  onDeleteSource,
}: SourcesPanelProps) {
  const [extracting, setExtracting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const fileId = file.name;
        setExtracting((prev) => new Set([...prev, fileId]));
        try {
          await onFileAdd(file);
        } catch (err) {
          setError(
            `Failed to add ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
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

  const isDragging = useDropZone(containerRef, handleFiles);

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col border-r border-neutral-200 dark:border-neutral-800 relative"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Sources
        </h2>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 pt-2">
          <div className="flex items-start gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Sources list */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-3 min-h-0">
        {sources.length === 0 && extracting.size === 0 && !isSearching ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-3">
              <FileText size={20} className="text-neutral-400" />
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Saved sources appear here
            </p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
              Add files, web searches, or research
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Extracting indicators */}
            {Array.from(extracting).map((fileId) => (
              <div
                key={fileId}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 animate-pulse"
              >
                <Loader2 size={14} className="text-neutral-400 animate-spin shrink-0" />
                <span className="text-xs text-neutral-500 truncate">{fileId}</span>
              </div>
            ))}

            {/* Source items */}
            {sources.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                onDelete={() => onDeleteSource(source.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom: Add sources dropdown */}
      <div className="px-3 py-3 border-t border-neutral-200 dark:border-neutral-800 relative">
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
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowAddMenu(false)}
            />
            <div className="absolute bottom-full left-3 right-3 mb-1 z-50 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1">
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(false);
                  fileInputRef.current?.click();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <File size={15} className="text-neutral-500" />
                Files
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
            </div>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              handleFiles(Array.from(e.target.files));
              e.target.value = '';
            }
          }}
        />
      </div>

      {/* Drop zone overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <Upload size={24} className="text-blue-500" />
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
              Drop files to add as sources
            </span>
          </div>
        </div>
      )}

      {/* Web Search Overlay */}
      {showSearchOverlay && (
        <WebSearchOverlay
          isSearching={isSearching}
          onSearch={async (query, mode) => {
            setError(null);
            try {
              await onWebSearch(query, mode);
              setShowSearchOverlay(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Search failed');
            }
          }}
          onClose={() => setShowSearchOverlay(false)}
        />
      )}
    </div>
  );
}

// ── Web Search Overlay ─────────────────────────────────────────────────

function WebSearchOverlay({
  isSearching,
  onSearch,
  onClose,
}: {
  isSearching: boolean;
  onSearch: (query: string, mode: 'web' | 'research') => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'web' | 'research'>('web');
  const [showModeMenu, setShowModeMenu] = useState(false);

  const modes = {
    web: { label: 'Web', icon: Globe },
    research: { label: 'Research', icon: Zap },
  };

  const ModeIcon = modes[mode].icon;

  const handleSubmit = () => {
    if (!query.trim() || isSearching) return;
    onSearch(query.trim(), mode);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            Search the web
          </h3>
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
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="What are you looking for?"
              disabled={isSearching}
              autoFocus
              className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none min-w-0"
            />
          </div>

          {/* Mode selector */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModeMenu(!showModeMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
              >
                <ModeIcon size={12} />
                {modes[mode].label}
                <ChevronDown size={10} />
              </button>

              {showModeMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowModeMenu(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1 min-w-[130px]">
                    {(Object.keys(modes) as Array<'web' | 'research'>).map((m) => {
                      const Icon = modes[m].icon;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setMode(m);
                            setShowModeMenu(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${
                            mode === m
                              ? 'text-neutral-900 dark:text-white'
                              : 'text-neutral-600 dark:text-neutral-400'
                          }`}
                        >
                          <Icon size={12} />
                          {modes[m].label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <span className="text-xs text-neutral-400 flex-1">
              {mode === 'research'
                ? 'Deep research with synthesis'
                : 'Quick web search'}
            </span>
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
          <button
            type="button"
            onClick={handleSubmit}
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
        </div>
      </div>
    </div>
  );
}

// ── Source Item ─────────────────────────────────────────────────────────

function SourceItem({
  source,
  onDelete,
}: {
  source: ResearchSource;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group relative rounded-lg border border-neutral-200 dark:border-neutral-700/60 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer"
      >
        <div className="w-6 h-6 rounded bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
          {source.type === 'web' ? (
            <Globe size={12} className="text-neutral-500" />
          ) : (
            <FileText size={12} className="text-neutral-500" />
          )}
        </div>
        <span className="text-xs text-neutral-700 dark:text-neutral-300 truncate flex-1">
          {source.name}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all"
        >
          <X size={12} className="text-neutral-400" />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2.5 max-h-40 overflow-y-auto">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap line-clamp-6">
            {source.content.slice(0, 500)}
            {source.content.length > 500 && '...'}
          </p>
        </div>
      )}
    </div>
  );
}
