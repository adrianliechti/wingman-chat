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
import { SLIDE_STYLES, PODCAST_STYLES } from '../hooks/useNotebook';

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
  const [openMenu, setOpenMenu] = useState<OutputType | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const styleMenus: Partial<Record<OutputType, readonly { id: string; label: string }[]>> = {
    'slide-deck': SLIDE_STYLES,
    'audio-overview': PODCAST_STYLES,
  };

  return (
    <div className="h-full flex flex-col">


      {/* Output type buttons */}
      <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="grid grid-cols-2 gap-2">
          {OUTPUT_TYPES.map(({ type, label, icon: Icon }) => {
            const styles = styleMenus[type];
            if (styles) {
              return (
                <div key={type} className="relative" ref={openMenu === type ? menuRef : undefined}>
                  <button
                    type="button"
                    onClick={() => setOpenMenu((v) => v === type ? null : type)}
                    disabled={!hasSources}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="text-xs font-medium flex-1">{label}</span>
                    <ChevronDown size={12} className="shrink-0 opacity-50" />
                  </button>
                  {openMenu === type && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-2 border-white/40 dark:border-neutral-700/60 rounded-lg shadow-2xl shadow-black/40 dark:shadow-black/80 dark:ring-1 dark:ring-white/10 py-1">
                      {styles.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setOpenMenu(null); onGenerate(type, s.id); }}
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
          <div className="space-y-1">
            {outputs.map((output) => {
              const typeInfo = OUTPUT_TYPES.find((t) => t.type === output.type);
              const Icon = typeInfo?.icon || StickyNote;
              const isGenerating = output.status === 'generating';
              const isError = output.status === 'error';

              return (
                <div
                  key={output.id}
                  className={`group/output flex items-center gap-2 py-1.5 transition-colors ${
                    isGenerating
                      ? 'opacity-60'
                      : isError
                        ? 'opacity-75'
                        : 'cursor-pointer'
                  }`}
                  onClick={() => {
                    if (output.status === 'completed') onSelectOutput(output);
                  }}
                >
                    <div className="w-6 h-6 rounded bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                      {isGenerating ? (
                        <Loader2 size={13} className="text-neutral-400 animate-spin" />
                      ) : isError ? (
                        <AlertCircle size={13} className="text-red-400" />
                      ) : (
                        <Icon size={13} className="text-neutral-500" />
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
                        className="invisible group-hover/output:visible p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                      >
                        <X size={12} className="text-neutral-400" />
                      </button>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
