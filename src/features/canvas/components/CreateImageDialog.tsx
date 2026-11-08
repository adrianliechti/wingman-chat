import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import {
  ArrowRight,
  Brain,
  ChevronDown,
  Expand,
  FileImage,
  Film,
  Gauge,
  HardDrive,
  ImagePlus,
  Layers,
  Loader2,
  Sparkles,
  Timer,
  Upload,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { imageFiles } from "../lib/images";
import {
  constrainSelection,
  EMPTY_SELECTION,
  type RenderSelection,
  rendererSubmenus,
  supportedAspects,
} from "../lib/rendererOptions";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { DEFAULT_DRIVE_DOWNLOAD_MAX_BYTES, downloadDriveFile } from "@/shared/lib/drives";
import type { ImageStyle } from "@/shared/lib/imageStyles";
import { notify } from "@/shared/lib/notify";
import { readAsDataURL, resizeImageBlob } from "@/shared/lib/utils";
import type { Model } from "@/shared/types/chat";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { ModelDropdown } from "@/shared/ui/ModelDropdown";

export interface GenerationRequest {
  /** What the user typed. */
  text: string;
  /** Prompt sent to the model: the text plus the style fragment. */
  prompt: string;
  style: string | null;
  model: Model;
  selection: RenderSelection;
  references: Blob[];
}

interface Reference {
  blob: Blob;
  dataUrl: string;
}

interface CreateImageDialogProps {
  open: boolean;
  onClose: () => void;
  models: Model[];
  model: Model | null;
  onSelectModel: (model: Model) => void;
  styles: ImageStyle[];
  stylePrompts: Record<string, string>;
  onGenerate: (request: GenerationRequest) => void;
  /** "Open a photo" instead of generating one. */
  onOpenPhoto: () => void;
  disclaimer?: ReactNode;
}

const MAX_REFERENCES = 4;
const COLLAPSED_STYLES = 10;

async function toReference(blob: Blob): Promise<Reference> {
  const resized = await resizeImageBlob(blob, 1024, 1024);
  return { blob: resized, dataUrl: await readAsDataURL(resized) };
}

/** Modal for a new generation: prompt, references, aspect, style, model levers. */
export function CreateImageDialog({
  open,
  onClose,
  models,
  model,
  onSelectModel,
  styles,
  stylePrompts,
  onGenerate,
  onOpenPhoto,
  disclaimer,
}: CreateImageDialogProps) {
  const config = getConfig();
  const [text, setText] = useState("");
  const [style, setStyle] = useState<string | null>(null);
  const [selection, setSelection] = useState<RenderSelection>({ ...EMPTY_SELECTION, quality: "medium" });
  const [references, setReferences] = useState<Reference[]>([]);
  const [showAllStyles, setShowAllStyles] = useState(false);
  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);
  const [loadingReferences, setLoadingReferences] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Keep only the levers the chosen model supports; the gateway ignores the rest anyway.
  const constrained = useMemo(() => constrainSelection(model, selection), [model, selection]);
  const aspects = supportedAspects(model);
  // SVG and GIF are drawn from the prompt alone; references stay for PNG.
  const textOnly = constrained.format !== null;

  const addReferences = useCallback(async (blobs: Blob[]) => {
    if (!blobs.length) return;
    setLoadingReferences(true);
    const prepared = await Promise.allSettled(blobs.map(toReference));
    const added = prepared.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    setReferences((current) => [...current, ...added].slice(0, MAX_REFERENCES));
    setLoadingReferences(false);
  }, []);

  const handleDriveFiles = useCallback(
    (files: SelectedFile[]) => {
      const maxBytes = config.vision?.maxFileSize ?? DEFAULT_DRIVE_DOWNLOAD_MAX_BYTES;
      setLoadingReferences(true);
      Promise.all(files.map((file) => downloadDriveFile(file, maxBytes)))
        .then((downloaded) => addReferences(downloaded))
        .catch((error: unknown) => notify.error("Couldn't load reference", error))
        .finally(() => setLoadingReferences(false));
    },
    [addReferences, config.vision?.maxFileSize],
  );

  const canSubmit = !!model && (text.trim().length > 0 || (!textOnly && references.length > 0));

  const submit = () => {
    if (!model || !canSubmit) return;
    const fragment = style ? stylePrompts[style] : undefined;
    const trimmed = text.trim();
    const prompt = fragment ? `${trimmed}${trimmed ? ", " : ""}${fragment}` : trimmed;
    onGenerate({
      text: trimmed,
      prompt,
      style,
      model,
      selection: constrained,
      references: textOnly ? [] : references.map((reference) => reference.blob),
    });
    setText("");
    setReferences([]);
    onClose();
  };

  // Re-focus the prompt whenever the dialog opens.
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => textarea.current?.focus());
  }, [open]);

  const styleGroups = useMemo(() => {
    const groups: { category: string; items: ImageStyle[] }[] = [];
    for (const item of styles) {
      const last = groups.at(-1);
      if (last && last.category === item.category) last.items.push(item);
      else groups.push({ category: item.category, items: [item] });
    }
    return groups;
  }, [styles]);
  const visibleStyles = showAllStyles ? styles : styles.slice(0, COLLAPSED_STYLES);
  const hiddenSelected = !showAllStyles && style && !visibleStyles.some((item) => item.name === style);

  const submenus = rendererSubmenus(model, constrained, setSelection, {
    quality: <Gauge size={14} />,
    resolution: <Expand size={14} />,
    background: <Layers size={14} />,
    complexity: <Brain size={14} />,
    format: <FileImage size={14} />,
    frames: <Film size={14} />,
    speed: <Timer size={14} />,
  });

  const chip = (item: ImageStyle) => {
    const selected = style === item.name;
    return (
      <button
        key={item.name}
        type="button"
        aria-pressed={selected}
        title={item.prompt}
        onClick={() => setStyle(selected ? null : item.name)}
        className={cn(
          "rounded-full border px-2.5 py-1 text-xs transition-colors",
          selected
            ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
            : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-white",
        )}
      >
        {item.name}
      </button>
    );
  };

  return (
    <>
      <Transition appear show={open} as={Fragment}>
        <Dialog as="div" className="relative z-80" onClose={onClose}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
          </TransitionChild>
          <div className="fixed inset-x-0 app-viewport overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="flex max-h-[calc(var(--app-height)-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-200/60 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-neutral-700/60 dark:bg-neutral-900/95">
                  <div className="flex shrink-0 items-center justify-between border-b border-neutral-200/60 px-5 py-3 dark:border-neutral-800/60">
                    <DialogTitle className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      New image
                    </DialogTitle>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Close"
                      className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="flex min-h-0 max-h-[calc(var(--app-height)*0.7)] flex-col gap-5 overflow-y-auto px-5 py-4">
                    <div className="shrink-0 rounded-xl border border-neutral-200/70 bg-neutral-50/60 focus-within:border-neutral-400 dark:border-neutral-700/60 dark:bg-neutral-800/40 dark:focus-within:border-neutral-500">
                      <textarea
                        ref={textarea}
                        aria-label="Prompt"
                        rows={3}
                        value={text}
                        placeholder={
                          constrained.format === "gif"
                            ? "Describe the animation you want…"
                            : constrained.format === "svg"
                              ? "Describe the illustration you want…"
                              : "Describe the image you want…"
                        }
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            submit();
                          }
                        }}
                        onPaste={(event) => {
                          const files = imageFiles(event.clipboardData.items);
                          if (files.length) {
                            event.preventDefault();
                            void addReferences(files);
                          }
                        }}
                        className="block w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
                      />
                      {textOnly ? (
                        <p className="px-4 pb-3 text-xs text-neutral-500 dark:text-neutral-400">
                          {constrained.format === "gif" ? "GIFs" : "SVGs"} are generated from the prompt alone, without
                          reference images.
                        </p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
                          {references.map((reference, index) => (
                            <div key={reference.dataUrl.slice(-32) + index} className="group relative size-12">
                              <img
                                src={reference.dataUrl}
                                alt={`Reference ${index + 1}`}
                                className="size-full rounded-lg object-cover ring-1 ring-black/10 dark:ring-white/10"
                              />
                              <button
                                type="button"
                                aria-label={`Remove reference ${index + 1}`}
                                onClick={() => setReferences((current) => current.filter((_, i) => i !== index))}
                                className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-neutral-800 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100 dark:bg-neutral-200 dark:text-neutral-900"
                              >
                                <X size={9} />
                              </button>
                            </div>
                          ))}
                          {loadingReferences && (
                            <div className="flex size-12 items-center justify-center rounded-lg bg-neutral-200/60 dark:bg-neutral-700/60">
                              <Loader2 size={14} className="animate-spin text-neutral-500" />
                            </div>
                          )}
                          {references.length < MAX_REFERENCES &&
                            (config.drives.length > 0 ? (
                              <DropdownMenu
                                anchor="bottom start"
                                trigger={
                                  <MenuButton
                                    title="Add reference image"
                                    className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200"
                                  >
                                    <ImagePlus size={14} />
                                    Reference
                                  </MenuButton>
                                }
                              >
                                <DropdownMenuItem
                                  icon={<Upload size={15} />}
                                  onClick={() => fileInput.current?.click()}
                                >
                                  Upload
                                </DropdownMenuItem>
                                {config.drives.map((drive) => (
                                  <DropdownMenuItem
                                    key={drive.id}
                                    icon={<HardDrive size={15} />}
                                    onClick={() => setActiveDrive(drive)}
                                  >
                                    {drive.name}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenu>
                            ) : (
                              <button
                                type="button"
                                title="Add reference image"
                                onClick={() => fileInput.current?.click()}
                                className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200"
                              >
                                <ImagePlus size={14} />
                                Reference
                              </button>
                            ))}
                        </div>
                      )}
                    </div>

                    {aspects.length > 0 && (
                      <div>
                        <div className="mb-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                          Aspect
                        </div>
                        <div role="radiogroup" aria-label="Aspect ratio" className="flex flex-wrap gap-2">
                          {[
                            { value: null as string | null, label: "Auto", description: "Model default" },
                            ...aspects,
                          ].map((option) => {
                            const checked = constrained.aspect === option.value;
                            const [w, h] = option.value ? option.value.split(":").map(Number) : [0, 0];
                            return (
                              <button
                                key={option.label}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                title={option.description}
                                onClick={() => setSelection({ ...selection, aspect: option.value })}
                                className={cn(
                                  "flex h-14 w-16 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] transition-colors",
                                  checked
                                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                                    : "border-neutral-200 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500",
                                )}
                              >
                                <span className="flex h-6 w-9 items-center justify-center">
                                  {option.value ? (
                                    <span
                                      className={cn(
                                        "rounded-[3px] border-[1.5px]",
                                        checked ? "border-current" : "border-neutral-400 dark:border-neutral-500",
                                      )}
                                      style={
                                        w >= h
                                          ? { width: 28, height: 28 * (h / w) }
                                          : { width: 24 * (w / h), height: 24 }
                                      }
                                    />
                                  ) : (
                                    <Sparkles size={14} />
                                  )}
                                </span>
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {styles.length > 0 && (
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                            Style{style ? ` · ${style}` : ""}
                          </div>
                          {styles.length > COLLAPSED_STYLES && (
                            <button
                              type="button"
                              onClick={() => setShowAllStyles((value) => !value)}
                              className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                            >
                              {showAllStyles ? "Fewer styles" : "All styles"}
                              <ChevronDown
                                size={12}
                                className={cn("transition-transform", showAllStyles && "rotate-180")}
                              />
                            </button>
                          )}
                        </div>
                        {showAllStyles ? (
                          <div className="space-y-3">
                            {styleGroups.map((group) => (
                              <div key={group.category || "styles"}>
                                {group.category && (
                                  <div className="mb-1.5 text-[10px] tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                                    {group.category}
                                  </div>
                                )}
                                <div
                                  role="group"
                                  aria-label={group.category || "Styles"}
                                  className="flex flex-wrap gap-1.5"
                                >
                                  {group.items.map(chip)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div role="group" aria-label="Styles" className="flex flex-wrap gap-1.5">
                            {visibleStyles.map(chip)}
                            {hiddenSelected && chip(styles.find((item) => item.name === style)!)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-200/60 px-4 py-3 dark:border-neutral-800/60">
                    <div className="flex min-w-0 items-center gap-3">
                      <ModelDropdown
                        models={models}
                        value={model?.id ?? ""}
                        onChange={(id) => {
                          const next = models.find((candidate) => candidate.id === id);
                          if (next) onSelectModel(next);
                        }}
                        dropdownClassName="w-auto min-w-48 whitespace-nowrap"
                        submenus={submenus}
                        trigger={({ getProps }) => (
                          <button
                            type="button"
                            {...getProps()}
                            className="flex max-w-56 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/5 dark:hover:text-white"
                          >
                            <Sparkles size={14} className="shrink-0" />
                            <span className="truncate">{model?.name ?? model?.id ?? "Model"}</span>
                            <ChevronDown size={12} className="shrink-0 opacity-60" />
                          </button>
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenPhoto();
                        }}
                        className="hidden text-xs text-neutral-500 hover:text-neutral-800 sm:block dark:text-neutral-400 dark:hover:text-neutral-200"
                      >
                        Open a photo instead…
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={!canSubmit}
                      className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      Generate
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  {disclaimer && (
                    <div className="shrink-0 border-t border-neutral-200/60 px-5 py-2 text-[11px] text-neutral-500 dark:border-neutral-800/60 dark:text-neutral-400">
                      {disclaimer}
                    </div>
                  )}
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void addReferences(imageFiles(event.target.files));
          event.target.value = "";
        }}
      />
      {activeDrive && (
        <DrivePicker
          isOpen
          onClose={() => setActiveDrive(null)}
          drive={activeDrive}
          onFilesSelected={handleDriveFiles}
          multiple
          accept="image/*"
        />
      )}
    </>
  );
}
