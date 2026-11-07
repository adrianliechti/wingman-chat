import { FolderOpen, ImagePlus, Info, Loader2, PlusIcon, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreateImageDialog, type GenerationRequest } from "@/features/canvas/components/CreateImageDialog";
import { Editor, NAV_BUTTON_CLASS } from "@/features/canvas/components/Editor";
import { Filmstrip, type PendingGeneration } from "@/features/canvas/components/Filmstrip";
import { Viewer } from "@/features/canvas/components/Viewer";
import { useImageStyles } from "@/features/canvas/hooks/useImageStyles";
import { newVersion, useImages } from "@/features/canvas/hooks/useImages";
import { useRendererModels } from "@/features/canvas/hooks/useRendererModels";
import { fileTitle, imageDimensions, imageFiles, viewOnlyFormat } from "@/features/canvas/lib/images";
import { aspectRatioValue } from "@/features/canvas/lib/rendererOptions";
import type { Image } from "@/features/canvas/types/canvas";
import { getConfig } from "@/shared/config";
import { useDropZone } from "@/shared/hooks/useDropZone";
import { useBreakpoint } from "@/shared/hooks/useMediaQuery";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { sanitizeHtmlToReact } from "@/shared/lib/htmlToReact";
import { notify } from "@/shared/lib/notify";
import { readAsDataURL } from "@/shared/lib/utils";
import type { Model } from "@/shared/types/chat";
import { useNavigation } from "@/shell/hooks/useNavigation";

function CanvasBackground() {
  const mask = "radial-gradient(ellipse at center, black 40%, transparent 85%)";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ WebkitMaskImage: mask, maskImage: mask }}
    >
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          backgroundImage: "radial-gradient(rgb(0 0 0 / 0.08) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          backgroundImage: "radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
    </div>
  );
}

function loadDisclaimer() {
  try {
    const config = getConfig();
    return config.renderer?.disclaimer?.trim()
      ? sanitizeHtmlToReact(config.renderer.disclaimer, { keyPrefix: "canvas-disclaimer" })
      : null;
  } catch {
    return null;
  }
}

interface PendingItem extends PendingGeneration {
  request: GenerationRequest;
}

type CreateImage = ReturnType<typeof useImages>["createImage"];

/** Run one generation; reports back through the callbacks so the page stays declarative. */
async function runGeneration(
  request: GenerationRequest,
  createImage: CreateImage,
  onDone: (image: Image) => void,
  onError: (message: string) => void,
) {
  try {
    const client = getConfig().client;
    const blob = await client.generateImage(request.model.id, request.prompt, request.references, {
      aspectRatio: request.selection.aspect ?? undefined,
      quality: request.selection.quality ?? undefined,
      resolution: request.selection.resolution ?? undefined,
      background: request.selection.background ?? undefined,
      complexity: request.selection.complexity ?? undefined,
      format: request.selection.format ?? undefined,
      frameCount: request.selection.frameCount ?? undefined,
      frameDurationMs: request.selection.frameDurationMs ?? undefined,
    });
    const [data, size] = await Promise.all([readAsDataURL(blob), imageDimensions(blob)]);
    const image = await createImage({
      prompt: request.prompt,
      model: request.model.id,
      data,
      ...size,
      versions: [newVersion("generated", request.prompt, request.model.id)],
    });
    onDone(image);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError(message);
  }
}

/** Store dropped, pasted or picked photos as editable images. */
async function importPhotos(files: File[], createImage: CreateImage): Promise<Image | null> {
  let last: Image | null = null;
  for (const file of files) {
    try {
      const [data, size] = await Promise.all([readAsDataURL(file), imageDimensions(file)]);
      last = await createImage({
        title: fileTitle(file.name),
        prompt: "",
        model: "",
        data,
        ...size,
        versions: [newVersion("upload")],
      });
    } catch (error) {
      notify.error(`Couldn't open ${file.name}`, error);
    }
  }
  return last;
}

export function CanvasPage() {
  const config = getConfig();
  const { setRightActions } = useNavigation();
  const compact = !useBreakpoint("md");
  const { images, isLoaded, createImage, updateImage, deleteImage } = useImages();
  const models = useRendererModels();
  const { styles, prompts: stylePrompts } = useImageStyles();
  const disclaimer = useMemo(() => loadDisclaimer(), []);

  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pick an initial model once the list loads: the configured renderer, else the first.
  useEffect(() => {
    if (selectedModel || models.length === 0) return;
    const configured = models.find((model) => model.id === config.renderer?.model);
    setSelectedModel(configured ?? models[0]);
  }, [models, selectedModel, config.renderer?.model]);

  const selectedImage = useMemo(
    () => (selectedId ? (images.find((image) => image.id === selectedId) ?? null) : null),
    [images, selectedId],
  );
  const selectedPending = useMemo(
    () => (selectedId ? (pending.find((item) => item.id === selectedId) ?? null) : null),
    [pending, selectedId],
  );

  // Keep a sensible selection: the newest image when nothing (or something
  // deleted) is selected, and nothing once the library is empty.
  useEffect(() => {
    if (!isLoaded) return;
    if (selectedImage || selectedPending) return;
    setSelectedId(images[0]?.id ?? pending[0]?.id ?? null);
  }, [isLoaded, images, pending, selectedImage, selectedPending]);

  const openPhotos = useCallback(
    (files: File[]) => {
      const accepted = imageFiles(files);
      if (!accepted.length) return;
      setImporting(true);
      void importPhotos(accepted, createImage)
        .then((image) => {
          if (image) setSelectedId(image.id);
        })
        .finally(() => setImporting(false));
    },
    [createImage],
  );

  const startGeneration = useCallback(
    (request: GenerationRequest, retryId?: string) => {
      const id = retryId ?? crypto.randomUUID();
      const item: PendingItem = {
        id,
        prompt: request.text || request.prompt,
        aspect: aspectRatioValue(request.selection.aspect),
        status: "running",
        request,
      };
      setPending((current) => [item, ...current.filter((existing) => existing.id !== id)]);
      setSelectedId(id);
      void runGeneration(
        request,
        createImage,
        (image) => {
          setPending((current) => current.filter((existing) => existing.id !== id));
          setSelectedId((current) => (current === id || current === null ? image.id : current));
        },
        (message) => {
          notify.error("Image generation failed", message);
          setPending((current) =>
            current.map((existing) =>
              existing.id === id ? { ...existing, status: "error", error: message } : existing,
            ),
          );
        },
      );
    },
    [createImage],
  );

  const retryPending = useCallback(
    (id: string) => {
      const item = pending.find((existing) => existing.id === id);
      if (item) startGeneration(item.request, id);
    },
    [pending, startGeneration],
  );

  const dismissPending = useCallback((id: string) => {
    setPending((current) => current.filter((existing) => existing.id !== id));
  }, []);

  const removeImage = useCallback(
    async (id: string) => {
      const image = images.find((existing) => existing.id === id);
      const confirmed = await confirm({
        title: "Delete this image?",
        message: image?.title || image?.prompt || "The image and its adjustments will be removed.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (confirmed) deleteImage(id);
    },
    [images, deleteImage],
  );

  const openCreate = useCallback(() => setCreateOpen(true), []);
  const openPhotoPicker = useCallback(() => fileInputRef.current?.click(), []);

  // The editor owns the top-bar actions while an image is open.
  useEffect(() => {
    if (selectedImage) return;
    setRightActions(
      <button type="button" className={NAV_BUTTON_CLASS} onClick={openCreate} title="New image" aria-label="New image">
        <PlusIcon size={20} />
      </button>,
    );
    return () => setRightActions(null);
  }, [selectedImage, setRightActions, openCreate]);

  // Dropped or pasted photos open as new images.
  const isDragging = useDropZone(containerRef, openPhotos);
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (createOpen) return;
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const files = imageFiles(event.clipboardData?.items ?? ([] as File[]));
      if (files.length) {
        event.preventDefault();
        openPhotos(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [createOpen, openPhotos]);

  const empty = isLoaded && images.length === 0 && pending.length === 0;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden pt-(--app-topbar) md:pt-14">
      <main ref={containerRef} className="relative flex min-h-0 w-full grow flex-col overflow-hidden">
        {isDragging && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-50/80 backdrop-blur-sm dark:bg-neutral-950/60">
            <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-neutral-400 bg-white/60 p-10 shadow-xl backdrop-blur-lg dark:border-neutral-500 dark:bg-neutral-900/60">
              <ImagePlus size={56} className="text-neutral-400 dark:text-neutral-500" />
              <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                Drop photos to open them
              </span>
            </div>
          </div>
        )}

        {empty ? (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
            <CanvasBackground />
            <div className="relative flex max-w-md flex-col items-center gap-4">
              <div className="rounded-2xl bg-white/70 p-4 text-neutral-500 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900/70 dark:text-neutral-400 dark:ring-white/10">
                <Sparkles size={28} />
              </div>
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Create or edit an image</h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Generate from a prompt, or open a photo to adjust light, color, and effects.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={openCreate}
                  autoFocus
                  className="flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  <PlusIcon size={16} />
                  New image
                </button>
                <button
                  type="button"
                  onClick={openPhotoPicker}
                  disabled={importing}
                  className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-white/70 px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-white disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900/70 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  {importing ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                  Open photo
                </button>
              </div>
              {disclaimer && (
                <div className="flex items-start gap-2 pt-2 text-left text-xs text-neutral-500 dark:text-neutral-400">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <div>{disclaimer}</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {selectedImage && viewOnlyFormat(selectedImage.data) ? (
              <Viewer key={selectedImage.id} image={selectedImage} onNew={openCreate} />
            ) : selectedImage ? (
              <Editor
                key={selectedImage.id}
                image={selectedImage}
                updateImage={updateImage}
                model={selectedModel}
                compact={compact}
                onNew={openCreate}
              />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                {selectedPending ? (
                  <GeneratingPlaceholder item={selectedPending} onRetry={retryPending} onDismiss={dismissPending} />
                ) : (
                  !isLoaded && <Loader2 size={24} className="animate-spin text-neutral-400" />
                )}
              </div>
            )}
            <Filmstrip
              images={images}
              pending={pending}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDelete={(id) => void removeImage(id)}
              onDismissPending={dismissPending}
              onRetryPending={retryPending}
              onNew={openCreate}
              onOpenPhoto={openPhotoPicker}
              importing={importing}
            />
          </>
        )}
      </main>

      <CreateImageDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        models={models}
        model={selectedModel}
        onSelectModel={setSelectedModel}
        styles={styles}
        stylePrompts={stylePrompts}
        onGenerate={startGeneration}
        onOpenPhoto={openPhotoPicker}
        disclaimer={disclaimer}
      />

      <input
        ref={fileInputRef}
        aria-label="Photos to open"
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) openPhotos(Array.from(event.target.files));
          event.target.value = "";
        }}
      />
    </div>
  );
}

function GeneratingPlaceholder({
  item,
  onRetry,
  onDismiss,
}: {
  item: PendingItem;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const aspect = item.aspect ?? 1;
  return (
    <div className="flex max-h-full max-w-full flex-col items-center gap-4">
      <div
        className={cn(
          "relative flex max-h-[60vh] w-[min(70vw,36rem)] items-center justify-center overflow-hidden rounded-2xl shadow-xl",
          item.status === "running"
            ? "animate-pulse bg-neutral-200 dark:bg-neutral-800"
            : "bg-red-50 ring-1 ring-red-200 dark:bg-red-950/30 dark:ring-red-900",
        )}
        style={{ aspectRatio: aspect }}
        role="status"
        aria-label={item.status === "running" ? "Generating image" : "Generation failed"}
      >
        {item.status === "running" ? (
          <Loader2 size={28} className="animate-spin text-neutral-400 dark:text-neutral-500" />
        ) : (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-red-700 dark:text-red-300">{item.error || "Image generation failed"}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-600 dark:text-neutral-200"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="max-w-md truncate text-xs text-neutral-500 dark:text-neutral-400" title={item.prompt}>
        {item.prompt}
      </p>
    </div>
  );
}
