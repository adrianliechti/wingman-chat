import { ArrowRight, Gauge, HardDrive, ImagePlus, Loader2, Paintbrush, Proportions, Sparkles, Upload, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import type { Model } from "@/shared/types/chat";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { ModelDropdown } from "@/shared/ui/ModelDropdown";

export type ImageQuality = "low" | "medium" | "high";

/** Curated aspect ratios; the backend snaps each to the nearest the model supports. */
const ASPECT_OPTIONS = [
  { value: "1:1", label: "1:1", description: "Square" },
  { value: "16:9", label: "16:9", description: "Widescreen" },
  { value: "9:16", label: "9:16", description: "Vertical" },
  { value: "4:3", label: "4:3", description: "Landscape" },
  { value: "3:4", label: "3:4", description: "Portrait" },
  { value: "3:2", label: "3:2", description: "Photo" },
  { value: "2:3", label: "2:3", description: "Photo (tall)" },
];

const QUALITY_OPTIONS: { value: ImageQuality; label: string; description: string }[] = [
  { value: "low", label: "Low", description: "Fastest, lower detail" },
  { value: "medium", label: "Medium", description: "Balanced" },
  { value: "high", label: "High", description: "Slowest, best detail" },
];

interface CanvasInputProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  onPaste: (e: React.ClipboardEvent) => void;
  referenceImages: { blob: Blob; dataUrl: string }[];
  onRemoveReferenceImage: (index: number) => void;
  onFileUploadClick: () => void;
  drives?: { id: string; name: string; icon?: string }[];
  onDriveSelect?: (drive: { id: string; name: string; icon?: string }) => void;
  isLoadingFiles?: boolean;
  models: Model[];
  selectedModel: Model | null;
  onSelectModel: (model: Model) => void;
  availableStyles: string[];
  selectedStyle: string | null;
  onSelectStyle: (style: string | null) => void;
  selectedAspect: string | null;
  onSelectAspect: (aspect: string | null) => void;
  selectedQuality: ImageQuality | null;
  onSelectQuality: (quality: ImageQuality | null) => void;
  placeholder?: string;
  helperText?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function CanvasInput({
  prompt,
  onPromptChange,
  onSubmit,
  onPaste,
  referenceImages,
  onRemoveReferenceImage,
  onFileUploadClick,
  drives,
  onDriveSelect,
  isLoadingFiles,
  models,
  selectedModel,
  onSelectModel,
  availableStyles,
  selectedStyle,
  onSelectStyle,
  selectedAspect,
  onSelectAspect,
  selectedQuality,
  onSelectQuality,
  placeholder = "Describe the image you want to generate...",
  helperText,
  disabled,
  autoFocus,
  className = "",
}: CanvasInputProps) {
  const referenceImageEntries = useMemo(() => {
    const counts = new Map<string, number>();

    return referenceImages.map((img, index) => {
      const baseKey = img.dataUrl.slice(0, 64);
      const occurrence = (counts.get(baseKey) ?? 0) + 1;
      counts.set(baseKey, occurrence);
      return { img, index, key: `${baseKey}:${occurrence}` };
    });
  }, [referenceImages]);

  const canSubmit = (prompt.trim() || referenceImages.length > 0) && !disabled;

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onPromptChange(e.target.value);
    },
    [onPromptChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (canSubmit) {
          onSubmit();
        }
      }
    },
    [canSubmit, onSubmit],
  );

  return (
    <div
      className={`flex flex-col rounded-2xl backdrop-blur-2xl shadow-sm border-0 md:border border-t border-solid border-neutral-200/60 dark:border-neutral-700/60 bg-white/60 dark:bg-neutral-950/70 w-full overflow-hidden ${className}`}
    >
      {/* Reference images above text (like chat attachments) */}
      {(referenceImages.length > 0 || isLoadingFiles) && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {referenceImageEntries.map(({ img, index, key }) => (
            <div
              key={key}
              className="relative size-14 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-sm group hover:shadow-md hover:border-white/60 dark:hover:border-white/40 transition-all"
            >
              <img
                src={img.dataUrl}
                alt={`Reference ${index + 1}`}
                className="size-full object-cover rounded-xl overflow-hidden"
              />
              <button
                type="button"
                className="absolute top-0.5 right-0.5 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all"
                onClick={() => onRemoveReferenceImage(index)}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {isLoadingFiles && (
            <div className="relative size-14 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-sm flex items-center justify-center animate-pulse">
              <Loader2 size={16} className="animate-spin text-neutral-400 dark:text-neutral-500" />
            </div>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="relative flex-1">
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the canvas composer opts in via the autoFocus prop
          autoFocus={autoFocus}
          className="block w-full px-4 pt-4 pb-2 max-h-[40vh] overflow-y-auto scrollbar-thin min-h-10 field-sizing-content resize-none bg-transparent text-sm text-neutral-800 dark:text-neutral-200 focus:outline-none whitespace-pre-wrap wrap-break-word"
          value={prompt}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
        />
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3 px-3 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Model dropdown — aspect & quality hang off it as flyout submenus */}
          <ModelDropdown
            models={models}
            value={selectedModel?.id ?? ""}
            onChange={(modelId) => {
              const m = models.find((mm) => mm.id === modelId);
              if (m) onSelectModel(m);
            }}
            dropdownClassName="w-auto min-w-48 whitespace-nowrap"
            submenus={[
              {
                icon: <Proportions size={14} />,
                label: "Aspect",
                options: ASPECT_OPTIONS,
                value: selectedAspect,
                onChange: onSelectAspect,
                defaultLabel: "Auto",
                defaultDescription: "Model default",
              },
              {
                icon: <Gauge size={14} />,
                label: "Quality",
                options: QUALITY_OPTIONS,
                value: selectedQuality,
                onChange: (v) => onSelectQuality(v as ImageQuality | null),
                defaultLabel: "Auto",
                defaultDescription: "Model default",
              },
            ]}
            trigger={({ getProps }) => (
              <button
                type="button"
                {...getProps()}
                className="flex items-center gap-1.5 pl-1 py-0 rounded-lg text-xs font-medium text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors max-w-48"
              >
                <span className="shrink-0 flex justify-center">
                  <Sparkles size={14} />
                </span>
                <span className="truncate min-w-0">{selectedModel?.name ?? selectedModel?.id ?? "Model"}</span>
              </button>
            )}
          />

          {/* Style dropdown */}
          <DropdownMenu
            anchor="bottom start"
            panelClassName="max-h-[50vh]! whitespace-nowrap"
            trigger={
              <MenuButton
                className={`flex items-center gap-1.5 pl-1 py-0 rounded-lg text-xs font-medium transition-colors max-w-48 ${
                  selectedStyle
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                <span className="shrink-0 flex justify-center">
                  <Paintbrush size={14} />
                </span>
                <span className="truncate min-w-0">{selectedStyle || "Style"}</span>
              </MenuButton>
            }
          >
            {selectedStyle && (
              <DropdownMenuItem onClick={() => onSelectStyle(null)}>
                <span className="italic text-neutral-500 dark:text-neutral-400">No style</span>
              </DropdownMenuItem>
            )}
            {availableStyles.map((style) => (
              <DropdownMenuItem
                key={style}
                selected={selectedStyle === style}
                onClick={() => onSelectStyle(selectedStyle === style ? null : style)}
              >
                <span className={selectedStyle === style ? "text-blue-600 dark:text-blue-400" : ""}>{style}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {referenceImages.length < 4 &&
            (drives && drives.length > 0 && onDriveSelect ? (
              <DropdownMenu
                anchor="bottom end"
                trigger={
                  <MenuButton
                    className="rounded-xl p-2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors hover:bg-neutral-100/70 dark:hover:bg-white/5"
                    title="Add reference image"
                  >
                    <ImagePlus size={16} />
                  </MenuButton>
                }
              >
                <DropdownMenuItem icon={<Upload size={15} />} onClick={onFileUploadClick}>
                  Upload
                </DropdownMenuItem>
                {drives.map((drive) => (
                  <DropdownMenuItem key={drive.id} icon={<HardDrive size={15} />} onClick={() => onDriveSelect(drive)}>
                    {drive.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            ) : (
              <button
                type="button"
                onClick={onFileUploadClick}
                className="rounded-xl p-2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors hover:bg-neutral-100/70 dark:hover:bg-white/5"
                title="Add reference image"
              >
                <ImagePlus size={16} />
              </button>
            ))}

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="rounded-xl p-2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors hover:bg-neutral-100/70 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Generate image"
          >
            <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {helperText ? (
        <div className="px-4 pb-4 text-center text-xs text-neutral-400 dark:text-neutral-500">{helperText}</div>
      ) : null}
    </div>
  );
}
