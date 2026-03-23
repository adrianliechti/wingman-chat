import { useState, useRef, useEffect } from 'react';
import {
  AudioLines,
  Presentation,
  BarChart3,
  Table2,
  Loader2,
  X,
  AlertCircle,
  StickyNote,
  CircleHelp,
  Network,
  ChevronDown,
} from 'lucide-react';
import type { NotebookOutput, NotebookSource, OutputType } from '../types/notebook';
import { SLIDE_STYLES } from '../hooks/useNotebook';

interface StudioPanelProps {
  sources: NotebookSource[];
  outputs: NotebookOutput[];
  onGenerate: (type: OutputType, styleId?: string) => void;
  onDeleteOutput: (outputId: string) => void;
  onSelectOutput: (output: NotebookOutput) => void;
}

const OUTPUT_TYPES: {
  type: OutputType;
  label: string;
  icon: typeof AudioLines;
}[] = [
  { type: 'audio-overview', label: 'Podcast', icon: AudioLines },
  { type: 'slide-deck', label: 'Slides', icon: Presentation },
  { type: 'data-table', label: 'Data Table', icon: Table2 },
  { type: 'infographic', label: 'Infographic', icon: BarChart3 },
  { type: 'quiz', label: 'Quiz', icon: CircleHelp },
  { type: 'mind-map', label: 'Mind Map', icon: Network },
];

export function StudioPanel({
  sources,
  outputs,
  onGenerate,
  onDeleteOutput,
  onSelectOutput,
}: StudioPanelProps) {
  const hasSources = sources.length > 0;
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const styleMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (styleMenuRef.current && !styleMenuRef.current.contains(e.target as Node)) {
        setShowStyleMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="h-full flex flex-col">


      {/* Output type buttons */}
      <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="grid grid-cols-2 gap-2">
          {OUTPUT_TYPES.map(({ type, label, icon: Icon }) => {
            if (type === 'slide-deck') {
              return (
                <div key={type} className="relative" ref={styleMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowStyleMenu((v) => !v)}
                    disabled={!hasSources}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="text-xs font-medium flex-1">{label}</span>
                    <ChevronDown size={12} className="shrink-0 opacity-50" />
                  </button>
                  {showStyleMenu && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1">
                      {SLIDE_STYLES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setShowStyleMenu(false); onGenerate('slide-deck', s.id); }}
                          className="w-full text-left px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button
                key={type}
                type="button"
                onClick={() => onGenerate(type)}
                disabled={!hasSources}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
              >
                <Icon size={16} className="shrink-0" />
                <span className="text-xs font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Generated outputs list */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-3 min-h-0">
        {outputs.length > 0 && (
          <div className="space-y-2">
            {outputs.map((output) => {
              const typeInfo = OUTPUT_TYPES.find((t) => t.type === output.type);
              const Icon = typeInfo?.icon || StickyNote;
              const isGenerating = output.status === 'generating';
              const isError = output.status === 'error';

              return (
                <div
                  key={output.id}
                  className={`group relative rounded-lg border transition-colors ${
                    isGenerating
                      ? 'border-neutral-200 dark:border-neutral-700/60 bg-neutral-50 dark:bg-neutral-800/30'
                      : isError
                        ? 'border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20'
                        : 'border-neutral-200 dark:border-neutral-700/60 hover:border-neutral-300 dark:hover:border-neutral-600 cursor-pointer'
                  }`}
                  onClick={() => {
                    if (output.status === 'completed') onSelectOutput(output);
                  }}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="w-7 h-7 rounded bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                      {isGenerating ? (
                        <Loader2 size={14} className="text-neutral-400 animate-spin" />
                      ) : isError ? (
                        <AlertCircle size={14} className="text-red-400" />
                      ) : (
                        <Icon size={14} className="text-neutral-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate">
                        {output.title}
                      </p>
                      <p className="text-[10px] text-neutral-400">
                        {isGenerating
                          ? 'Generating...'
                          : isError
                            ? output.error || 'Failed'
                            : new Date(output.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!isGenerating && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteOutput(output.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all"
                      >
                        <X size={12} className="text-neutral-400" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
