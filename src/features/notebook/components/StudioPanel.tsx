import {
  AlertCircle,
  AudioLines,
  BarChart3,
  ChevronDown,
  CircleHelp,
  Download,
  Loader2,
  Network,
  Presentation,
  StickyNote,
  Table2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PODCAST_STYLES, SLIDE_STYLES } from "../hooks/useNotebook";
import type { NotebookOutput, NotebookSource, OutputType } from "../types/notebook";

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
  { type: "audio-overview", label: "Podcast", icon: AudioLines },
  { type: "slide-deck", label: "Slides", icon: Presentation },
  { type: "data-table", label: "Data Table", icon: Table2 },
  { type: "infographic", label: "Infographic", icon: BarChart3 },
  { type: "quiz", label: "Quiz", icon: CircleHelp },
  { type: "mind-map", label: "Mind Map", icon: Network },
];

export function StudioPanel({ sources, outputs, onGenerate, onDeleteOutput, onSelectOutput }: StudioPanelProps) {
  const hasSources = sources.length > 0;
  const [openMenu, setOpenMenu] = useState<OutputType | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const downloadOutput = async (output: NotebookOutput) => {
    const slug = output.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    if (output.type === "audio-overview" && output.audioUrl) {
      downloadDataUrl(output.audioUrl, `${slug}.wav`);
    } else if (output.type === "infographic" && output.imageUrl) {
      downloadDataUrl(output.imageUrl, `${slug}.png`);
    } else if (output.type === "slide-deck" && output.slides?.length) {
      await downloadSlidesAsPdf(output.slides, slug);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const styleMenus: Partial<Record<OutputType, readonly { id: string; label: string }[]>> = {
    "slide-deck": SLIDE_STYLES,
    "audio-overview": PODCAST_STYLES,
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
                    onClick={() => setOpenMenu((v) => (v === type ? null : type))}
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
                          onClick={() => {
                            setOpenMenu(null);
                            onGenerate(type, s.id);
                          }}
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
              const isGenerating = output.status === "generating";
              const isError = output.status === "error";

              return (
                <div
                  key={output.id}
                  className={`group/output flex items-center gap-2 py-1.5 transition-colors ${isGenerating ? "opacity-60" : isError ? "opacity-75" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (output.status === "completed") {
                        onSelectOutput(output);
                      }
                    }}
                    className={`flex flex-1 min-w-0 items-center gap-2 text-left ${
                      output.status === "completed" ? "cursor-pointer" : "cursor-default"
                    }`}
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
                          ? "Generating..."
                          : isError
                            ? output.error || "Failed"
                            : new Date(output.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </button>
                  {!isGenerating && (
                    <div className="invisible group-hover/output:visible flex items-center shrink-0">
                      {output.status === "completed" && canDownload(output) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadOutput(output);
                          }}
                          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                          title="Download"
                        >
                          <Download size={12} className="text-neutral-400" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteOutput(output.id);
                        }}
                        className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                        title="Delete"
                      >
                        <X size={12} className="text-neutral-400" />
                      </button>
                    </div>
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

function canDownload(output: NotebookOutput): boolean {
  return (
    (output.type === "audio-overview" && !!output.audioUrl) ||
    (output.type === "infographic" && !!output.imageUrl) ||
    (output.type === "slide-deck" && !!output.slides?.length)
  );
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

async function downloadSlidesAsPdf(slides: string[], slug: string) {
  const { jsPDF } = await import("jspdf");

  // Load first image to get natural dimensions
  const firstImg = await loadImage(slides[0]);
  const w = firstImg.naturalWidth;
  const h = firstImg.naturalHeight;
  const landscape = w > h;

  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "px",
    format: [w, h],
  });

  doc.addImage(slides[0], "PNG", 0, 0, w, h);

  for (let i = 1; i < slides.length; i++) {
    doc.addPage([w, h], landscape ? "landscape" : "portrait");
    doc.addImage(slides[i], "PNG", 0, 0, w, h);
  }

  doc.save(`${slug}.pdf`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
