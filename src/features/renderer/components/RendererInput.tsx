import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { ArrowRight, HardDrive, ImagePlus, Loader2, Paintbrush, Sparkles, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { Model } from "@/shared/types/chat";

interface RendererInputProps {
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
  placeholder?: string;
  helperText?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function RendererInput({
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
  placeholder = "Describe the image you want to generate...",
  helperText,
  disabled,
  autoFocus,
  className = "",
}: RendererInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;

    if (prompt.length === 0) {
      inputRef.current.style.height = "auto";
    }
  }, [prompt]);

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

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div
      className={`flex flex-col rounded-2xl backdrop-blur-2xl shadow-2xl shadow-black/60 dark:shadow-black/80 border border-neutral-200/50 dark:border-neutral-900 bg-white/60 dark:bg-neutral-950/70 dark:ring-1 dark:ring-white/10 w-full max-w-2xl overflow-hidden ${className}`}
    >
      {/* Reference images above text (like chat attachments) */}
      {(referenceImages.length > 0 || isLoadingFiles) && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {referenceImageEntries.map(({ img, index, key }) => (
            <div
              key={key}
              className="relative size-14 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-sm group hover:shadow-md hover:border-white/60 dark:hover:border-white/40 transition-all overflow-hidden"
            >
              <img src={img.dataUrl} alt={`Reference ${index + 1}`} className="size-full object-cover" />
              <button
                type="button"
                className="absolute top-0.5 right-0.5 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
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
          ref={inputRef}
          className="px-4 pt-4 pb-2 flex-1 max-h-[40vh] overflow-y-auto min-h-12 resize-none bg-transparent text-sm text-neutral-800 dark:text-neutral-200 focus:outline-none whitespace-pre-wrap wrap-break-word"
          style={{ scrollbarWidth: "thin", minHeight: "2.5rem", height: "auto" }}
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
        <div className="flex min-w-0 items-center gap-1.5">
          {/* Model dropdown */}
          <Menu>
            <MenuButton className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors hover:bg-neutral-100/70 dark:hover:bg-white/5">
              <Sparkles size={13} />
              <span>{selectedModel?.name || "Model"}</span>
            </MenuButton>
            <MenuItems
              modal={false}
              transition
              anchor="bottom start"
              className="max-h-[50vh]! mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 shadow-2xl shadow-black/40 dark:shadow-black/80 dark:ring-1 dark:ring-white/10 z-50 overflow-y-auto"
            >
              {models.length === 0 ? (
                <div className="px-3 py-2 text-neutral-500 dark:text-neutral-400 text-sm">Loading models...</div>
              ) : (
                models.map((model) => (
                  <MenuItem key={model.id}>
                    <button
                      type="button"
                      onClick={() => onSelectModel(model)}
                      className="group flex w-full items-center px-3 py-2 text-sm data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 text-neutral-700 dark:text-neutral-300 transition-colors"
                    >
                      {model.name}
                    </button>
                  </MenuItem>
                ))
              )}
            </MenuItems>
          </Menu>

          {/* Style dropdown */}
          <Menu>
            <MenuButton
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-neutral-100/70 dark:hover:bg-white/5 ${
                selectedStyle
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              <Paintbrush size={13} />
              <span>{selectedStyle || "Style"}</span>
            </MenuButton>
            <MenuItems
              modal={false}
              transition
              anchor="bottom start"
              className="max-h-[50vh]! mt-2 rounded-xl border-2 bg-white/40 dark:bg-neutral-950/80 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 shadow-2xl shadow-black/40 dark:shadow-black/80 dark:ring-1 dark:ring-white/10 z-50 overflow-y-auto min-w-36"
            >
              {/* Clear style option */}
              {selectedStyle && (
                <MenuItem>
                  <button
                    type="button"
                    onClick={() => onSelectStyle(null)}
                    className="group flex w-full items-center px-3 py-2 text-sm data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 text-neutral-500 dark:text-neutral-400 transition-colors italic"
                  >
                    No style
                  </button>
                </MenuItem>
              )}
              {availableStyles.map((style) => (
                <MenuItem key={style}>
                  <button
                    type="button"
                    onClick={() => onSelectStyle(selectedStyle === style ? null : style)}
                    className={`group flex w-full items-center px-3 py-2 text-sm data-focus:bg-neutral-100/60 dark:data-focus:bg-white/5 transition-colors ${
                      selectedStyle === style
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    {style}
                  </button>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {referenceImages.length < 4 &&
            (drives && drives.length > 0 && onDriveSelect ? (
              <Menu>
                <MenuButton
                  className="rounded-xl p-2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors hover:bg-neutral-100/70 dark:hover:bg-white/5"
                  title="Add reference image"
                >
                  <ImagePlus size={16} />
                </MenuButton>
                <MenuItems
                  modal={false}
                  transition
                  anchor="bottom end"
                  className="mt-1 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-lg py-1 z-50 min-w-40"
                >
                  <MenuItem>
                    <button
                      type="button"
                      onClick={onFileUploadClick}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 transition-colors"
                    >
                      <Upload size={15} className="text-neutral-500" />
                      Upload
                    </button>
                  </MenuItem>
                  {drives.map((drive) => (
                    <MenuItem key={drive.id}>
                      <button
                        type="button"
                        onClick={() => onDriveSelect(drive)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 transition-colors"
                      >
                        <HardDrive size={15} className="text-neutral-500" />
                        {drive.name}
                      </button>
                    </MenuItem>
                  ))}
                </MenuItems>
              </Menu>
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
