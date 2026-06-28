import {
  AlertCircle,
  AudioLines,
  BarChart3,
  CircleHelp,
  Download,
  Loader2,
  MoreVertical,
  Network,
  Presentation,
  StickyNote,
  Table2,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import type { File } from "@/shared/types/file";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
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

  const DIALOG_TYPES = new Set<OutputType>(["slides", "podcast", "report", "infographic"]);

  const handleDialogGenerate = (_type: OutputType, { styleId, ...rest }: GeneratorOptions) => {
    onGenerate(_type, styleId, rest);
  };

  return (
    <div className="h-full flex flex-col @container/studio">
      {/* Output type buttons */}
      <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="grid grid-cols-3 @[13rem]/studio:grid-cols-2 gap-1.5 @[13rem]/studio:gap-2">
          {OUTPUT_TYPES.map(({ type, label, icon: Icon }) => {
            if (DIALOG_TYPES.has(type)) {
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDialogType(type)}
                  disabled={!hasSources}
                  title={label}
                  className="flex items-center justify-center gap-2 p-2 @[13rem]/studio:justify-start @[13rem]/studio:px-3 @[13rem]/studio:py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-0 overflow-hidden"
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="hidden @[13rem]/studio:inline text-xs font-medium truncate">{label}</span>
                </button>
              );
            }
            return (
              <button
                key={type}
                type="button"
                onClick={() => onGenerate(type)}
                disabled={!hasSources}
                title={label}
                className="flex items-center justify-center gap-2 p-2 @[13rem]/studio:justify-start @[13rem]/studio:px-3 @[13rem]/studio:py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-0 overflow-hidden"
              >
                <Icon size={16} className="shrink-0" />
                <span className="hidden @[13rem]/studio:inline text-xs font-medium truncate">{label}</span>
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
                      <p className="text-xs text-neutral-400">
                        {isGenerating ? (
                          "Generating..."
                        ) : isError ? (
                          output.error || "Failed"
                        ) : (
                          <>
                            <span className="@[14rem]/studio:hidden">
                              {new Date(output.createdAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                            <span className="hidden @[14rem]/studio:inline">
                              {new Date(output.createdAt).toLocaleString()}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </button>

                  {/* Actions menu — always visible, works on touch */}
                  {!isGenerating && (
                    <div className="shrink-0">
                      <DropdownMenu
                        anchor="bottom end"
                        trigger={
                          <MenuButton
                            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                            title="Actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical size={14} />
                          </MenuButton>
                        }
                      >
                        {output.status === "completed" && canDownload(output) && (
                          <DropdownMenuItem icon={<Download size={13} />} onClick={() => onDownloadOutput(output)}>
                            Download
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          icon={<Trash2 size={13} />}
                          destructive
                          onClick={() => onDeleteOutput(output.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
