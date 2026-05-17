import {
  AlertCircle,
  AudioLines,
  BarChart3,
  BookMarked,
  Boxes,
  CircleHelp,
  Download,
  Loader2,
  MoreHorizontal,
  Network,
  Presentation,
  StickyNote,
  Table2,
  Trash2,
  Workflow,
} from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import type { File } from "@/shared/types/file";
import type { BuildInstructionsOptions } from "../lib/styles";
import type { NotebookOutput, OutputType } from "../types/notebook";
import { type GeneratorOptions, OutputGeneratorDialog } from "./OutputGeneratorDialog";

interface StudioPanelProps {
  sources: File[];
  outputs: NotebookOutput[];
  onGenerate: (type: OutputType, styleId?: string, options?: BuildInstructionsOptions) => void;
  onDeleteOutput: (outputId: string) => void;
  onSelectOutput: (output: NotebookOutput) => void;
  /** Called when the user picks Download from the row action menu — delegates
   *  the actual save/modal flow to a hook owned by the page so the same
   *  modals are reused by the preview's Download icon. */
  onDownloadOutput: (output: NotebookOutput) => void;
  /** Whether the output is downloadable in the current state. */
  canDownload: (output: NotebookOutput) => boolean;
}

const OUTPUT_TYPES: {
  type: OutputType;
  label: string;
  icon: typeof AudioLines;
}[] = [
  { type: "podcast", label: "Podcast", icon: AudioLines },
  { type: "slides", label: "Slides", icon: Presentation },
  { type: "report", label: "Report", icon: Table2 },
  { type: "infographic", label: "Infographic", icon: BarChart3 },
  { type: "quiz", label: "Quiz", icon: CircleHelp },
  { type: "mindmap", label: "Mind Map", icon: Network },
  { type: "process", label: "Process", icon: Workflow },
  { type: "architecture", label: "Architecture", icon: Boxes },
  { type: "data-catalog", label: "Data Catalog", icon: BookMarked },
];

export function StudioPanel({
  sources,
  outputs,
  onGenerate,
  onDeleteOutput,
  onSelectOutput,
  onDownloadOutput,
  canDownload,
}: StudioPanelProps) {
  const hasSources = sources.length > 0;
  const [dialogType, setDialogType] = useState<OutputType | null>(null);
  // Keep the type stable during the exit animation.
  const stableDialogType = useRef<OutputType>("slides");
  if (dialogType) stableDialogType.current = dialogType;

  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [actionMenuPos, setActionMenuPos] = useState<{ top: number; right: number } | null>(null);

  const DIALOG_TYPES = new Set<OutputType>([
    "slides",
    "podcast",
    "report",
    "infographic",
    "process",
    "architecture",
    "data-catalog",
  ]);

  const handleDialogGenerate = (_type: OutputType, { styleId, ...rest }: GeneratorOptions) => {
    onGenerate(_type, styleId, rest);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Output type buttons */}
      <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="grid grid-cols-2 gap-2">
          {OUTPUT_TYPES.map(({ type, label, icon: Icon }) => {
            if (DIALOG_TYPES.has(type)) {
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDialogType(type)}
                  disabled={!hasSources}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="text-xs font-medium">{label}</span>
                </button>
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
                  className={cn(
                    "relative flex items-center gap-2 py-1.5 transition-colors",
                    isGenerating ? "opacity-60" : isError ? "opacity-75" : "",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (output.status === "completed") {
                        onSelectOutput(output);
                      }
                    }}
                    className={cn(
                      "flex flex-1 min-w-0 items-center gap-2 text-left",
                      output.status === "completed" ? "cursor-pointer" : "cursor-default",
                    )}
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

                  {/* Actions menu — always visible, works on touch */}
                  {!isGenerating && (
                    <div className="shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openActionMenu === output.id) {
                            setOpenActionMenu(null);
                            setActionMenuPos(null);
                          } else {
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            setActionMenuPos({
                              top: rect.bottom + 4,
                              right: window.innerWidth - rect.right,
                            });
                            setOpenActionMenu(output.id);
                          }
                        }}
                        className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                        title="Actions"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action popover rendered in a portal to escape overflow clipping */}
      {openActionMenu &&
        actionMenuPos &&
        (() => {
          const output = outputs.find((o) => o.id === openActionMenu);
          if (!output) return null;
          const downloadable = output.status === "completed" && canDownload(output);
          return createPortal(
            <>
              {/* backdrop */}
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onMouseDown={() => {
                  setOpenActionMenu(null);
                  setActionMenuPos(null);
                }}
              />
              <div
                className="fixed z-50 min-w-30 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl shadow-black/20 dark:shadow-black/60 py-1 overflow-hidden"
                style={{ top: actionMenuPos.top, right: actionMenuPos.right }}
              >
                {downloadable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenActionMenu(null);
                      setActionMenuPos(null);
                      onDownloadOutput(output);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <Download size={13} className="text-neutral-400 shrink-0" />
                    Download
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenActionMenu(null);
                    setActionMenuPos(null);
                    onDeleteOutput(output.id);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                >
                  <Trash2 size={13} className="shrink-0" />
                  Delete
                </button>
              </div>
            </>,
            document.body,
          );
        })()}

      {/* Output generator dialog */}
      <OutputGeneratorDialog
        open={dialogType !== null}
        type={stableDialogType.current}
        onClose={() => setDialogType(null)}
        onGenerate={handleDialogGenerate}
      />
    </div>
  );
}

