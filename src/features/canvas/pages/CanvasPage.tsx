import { ImagePlus, Loader2, PlusIcon } from "lucide-react";
import { Activity, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreatePanel, type GenerationRequest } from "@/features/canvas/components/CreatePanel";
import { Editor } from "@/features/canvas/components/Editor";
import { CanvasSidebar } from "@/features/canvas/components/CanvasSidebar";
import { Filmstrip } from "@/features/canvas/components/Filmstrip";
import { SongPlayer } from "@/features/canvas/components/SongPlayer";
import { Viewer } from "@/features/canvas/components/Viewer";
import { useImageStyles } from "@/features/canvas/hooks/useImageStyles";
import { type NewImage, newVersion, useImages } from "@/features/canvas/hooks/useImages";
import { useCanvasModels } from "@/features/canvas/hooks/useRendererModels";
import { useSwipe, type SwipeDirection } from "@/features/canvas/hooks/useSwipe";
import { fileTitle, imageDimensions, imageFiles, mediaNoun, viewOnlyFormat } from "@/features/canvas/lib/images";
import { asMp3, songMetadata, songPoster } from "@/features/canvas/lib/song";
import { videoMetadata } from "@/features/canvas/lib/video";
import { aspectRatioValue, creationKind } from "@/features/canvas/lib/rendererOptions";
import type { Image, PendingGeneration } from "@/features/canvas/types/canvas";
import { getConfig } from "@/shared/config";
import { useDropZone } from "@/shared/hooks/useDropZone";
import { useBreakpoint } from "@/shared/hooks/useMediaQuery";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { sanitizeHtmlToReact } from "@/shared/lib/htmlToReact";
import { notify } from "@/shared/lib/notify";
import { readAsDataURL } from "@/shared/lib/utils";
import { navButtonClassName } from "@/shared/ui/actionButton";
import type { Model, RenderFormat } from "@/shared/types/chat";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useSidebar } from "@/shell/hooks/useSidebar";

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

type GeneratedMedia = Pick<NewImage, "data" | "width" | "height" | "duration" | "peaks" | "blob" | "contentType">;

/** A song: the length and vocals are already part of the prompt, which is all a music model takes. */
async function generateSong(request: GenerationRequest): Promise<GeneratedMedia> {
  const blob = asMp3(await getConfig().client.generateSong(request.model.id, request.prompt));
  if (!blob?.size) throw new Error("The music model did not return an MP3 song");
  const { duration, peaks } = await songMetadata(blob);
  return { data: songPoster(peaks, request.prompt), duration, peaks, blob, contentType: blob.type };
}

/** An image or video from the renderer, with the pixels or poster the library shows. */
async function renderMedia(
  request: GenerationRequest,
  format: Exclude<RenderFormat, "mp3"> | null,
): Promise<GeneratedMedia> {
  const blob = await getConfig().client.render(request.model.id, request.prompt, request.references, {
    aspectRatio: request.selection.aspect ?? undefined,
    quality: request.selection.quality ?? undefined,
    resolution: request.selection.resolution ?? undefined,
    background: request.selection.background ?? undefined,
    complexity: request.selection.complexity ?? undefined,
    format: format ?? undefined,
    durationSeconds: request.selection.durationSeconds ?? undefined,
    frameCount: request.selection.frameCount ?? undefined,
    frameDurationMs: request.selection.frameDurationMs ?? undefined,
  });
  if (format !== "mp4") {
    const [data, size] = await Promise.all([readAsDataURL(blob), imageDimensions(blob)]);
    return { data, ...size };
  }
  if (blob.type !== "video/mp4") throw new Error("The renderer did not return an MP4 video");
  return { ...(await videoMetadata(blob)), blob, contentType: blob.type };
}

/** Run one generation; reports back through the callbacks so the page stays declarative. */
async function runGeneration(
  request: GenerationRequest,
  createImage: CreateImage,
  onDone: (image: Image) => void,
  onError: (message: string) => void,
) {
  try {
    const { format } = request.selection;
    const media = await (format === "mp3" ? generateSong(request) : renderMedia(request, format));
    const image = await createImage({
      prompt: request.prompt,
      model: request.model.id,
      ...media,
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
  const { setSidebarContent } = useSidebar();
  const compact = !useBreakpoint("md");
  const { images, isLoaded, createImage, updateImage, deleteImage } = useImages();
  const models = useCanvasModels();
  const { styles, prompts: stylePrompts } = useImageStyles();
  const disclaimer = useMemo(() => loadDisclaimer(), []);

  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pick an initial model once the list loads: the configured renderer, else
  // the first image model, so the create panel opens on its first tab.
  useEffect(() => {
    if (selectedModel || models.length === 0) return;
    const configured = models.find((model) => model.id === config.renderer?.model);
    setSelectedModel(configured ?? models.find((model) => creationKind(model) === "image") ?? models[0]);
  }, [models, selectedModel, config.renderer?.model]);

  const selectedImage = useMemo(
    () => (selectedId ? (images.find((image) => image.id === selectedId) ?? null) : null),
    [images, selectedId],
  );
  const selectedPending = useMemo(
    () => (selectedId ? (pending.find((item) => item.id === selectedId) ?? null) : null),
    [pending, selectedId],
  );
  // Vector, animated, video and song items are shown as they are; the rest open in the editor.
  const selectedFormat = selectedImage ? viewOnlyFormat(selectedImage.data, selectedImage.contentType) : null;
  // AI retouch in the editor needs an image model, whatever the panel last created with.
  const imageModel =
    creationKind(selectedModel) === "image"
      ? selectedModel
      : (models.find((model) => creationKind(model) === "image") ?? null);

  // With nothing selected the stage shows the create panel. Canvas opens on it,
  // and a selection whose item is gone (deleted, dismissed) falls back to it.
  const creating = !selectedImage && !selectedPending;

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
          // Follow the result only while its placeholder is still on the stage; someone
          // already writing the next prompt, or looking at older work, stays there.
          setSelectedId((current) => (current === id ? image.id : current));
        },
        (message) => {
          notify.error("Generation failed", message);
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
      const noun = mediaNoun(image ? viewOnlyFormat(image.data, image.contentType) : null);
      const confirmed = await confirm({
        title: `Delete this ${noun}?`,
        message: image?.title || image?.prompt || "The image and its adjustments will be removed.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!confirmed) return;
      if (id === selectedId) {
        // Step to the neighbour in the strip, or to the create panel after the last one.
        const index = images.findIndex((existing) => existing.id === id);
        setSelectedId(images[index + 1]?.id ?? images[index - 1]?.id ?? null);
      }
      deleteImage(id);
    },
    [images, selectedId, deleteImage],
  );

  const openCreate = useCallback(() => setSelectedId(null), []);
  const openPhotoPicker = useCallback(() => fileInputRef.current?.click(), []);

  // Phones browse the library from the drawer; desktop keeps the filmstrip.
  useEffect(() => {
    if (!compact) return;
    setSidebarContent(
      <CanvasSidebar
        images={images}
        pending={pending}
        selectedId={selectedId}
        isLoaded={isLoaded}
        importing={importing}
        onSelect={setSelectedId}
        onDelete={(id) => void removeImage(id)}
        onDismissPending={dismissPending}
        onRetryPending={retryPending}
        onNew={openCreate}
        onOpenPhoto={openPhotoPicker}
      />,
    );
    return () => setSidebarContent(null);
  }, [
    compact,
    images,
    pending,
    selectedId,
    isLoaded,
    importing,
    removeImage,
    dismissPending,
    retryPending,
    openCreate,
    openPhotoPicker,
    setSidebarContent,
  ]);

  // Phones: a swipe across the stage steps through the library in filmstrip order.
  const step = useCallback(
    (direction: SwipeDirection) => {
      const order = [...pending.map((item) => item.id), ...images.map((image) => image.id)];
      const index = order.indexOf(selectedId ?? "");
      const next = order[index + direction];
      if (index !== -1 && next) setSelectedId(next);
    },
    [pending, images, selectedId],
  );
  const onSwipe = compact ? step : undefined;
  const placeholderSwipe = useSwipe(onSwipe);

  // "New" is the only top-bar action, as on the chat and translate pages; the
  // editor and viewer keep their own controls in a toolbar over the stage.
  useEffect(() => {
    setRightActions(
      <button
        type="button"
        className={navButtonClassName}
        onClick={openCreate}
        title="New creation"
        aria-label="New creation"
      >
        <PlusIcon size={20} />
      </button>,
    );
    return () => setRightActions(null);
  }, [setRightActions, openCreate]);

  // Dropped or pasted photos open as new images.
  const isDragging = useDropZone(containerRef, openPhotos);
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // A paste into the prompt adds a reference there; anywhere else it opens the photo.
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
  }, [openPhotos]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden pt-(--app-topbar) pb-(--safe-bottom)">
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

        {/* The create page stays mounted behind a selected item, so a half-written
            prompt is still there on the way back. */}
        <Activity mode={creating ? "visible" : "hidden"}>
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <CreatePanel
              models={models}
              model={selectedModel}
              onSelectModel={setSelectedModel}
              styles={styles}
              stylePrompts={stylePrompts}
              onGenerate={startGeneration}
              disclaimer={disclaimer}
              // A phone would raise its keyboard over the form on every visit.
              autoFocus={!compact}
            />
          </div>
        </Activity>

        {selectedImage && selectedFormat === "mp3" ? (
          <SongPlayer key={selectedImage.id} image={selectedImage} onSwipe={onSwipe} />
        ) : selectedImage && selectedFormat ? (
          <Viewer key={selectedImage.id} image={selectedImage} onSwipe={onSwipe} />
        ) : selectedImage ? (
          <Editor
            key={selectedImage.id}
            image={selectedImage}
            updateImage={updateImage}
            model={imageModel}
            compact={compact}
            onSwipe={onSwipe}
          />
        ) : (
          selectedPending && (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4" {...placeholderSwipe}>
              <GeneratingPlaceholder item={selectedPending} onRetry={retryPending} onDismiss={dismissPending} />
            </div>
          )
        )}

        {!compact && (
          <Filmstrip
            images={images}
            pending={pending}
            selectedId={selectedId}
            creating={creating}
            onSelect={setSelectedId}
            onDelete={(id) => void removeImage(id)}
            onDismissPending={dismissPending}
            onRetryPending={retryPending}
            onNew={openCreate}
            onOpenPhoto={openPhotoPicker}
            importing={importing}
          />
        )}
      </main>

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
    <div className="flex max-h-full w-[min(70vw,36rem)] max-w-full min-w-0 flex-col items-center gap-4">
      <div
        className={cn(
          "relative flex max-h-[60vh] w-full items-center justify-center overflow-hidden rounded-2xl shadow-xl",
          item.status === "running"
            ? "animate-pulse bg-neutral-200 dark:bg-neutral-800"
            : "bg-red-50 ring-1 ring-red-200 dark:bg-red-950/30 dark:ring-red-900",
        )}
        style={{ aspectRatio: aspect }}
        role="status"
        aria-label={item.status === "running" ? "Generating media" : "Generation failed"}
      >
        {item.status === "running" ? (
          <Loader2 size={28} className="animate-spin text-neutral-400 dark:text-neutral-500" />
        ) : (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-red-700 dark:text-red-300">{item.error || "Generation failed"}</p>
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
      <p
        className="line-clamp-3 w-full max-w-md text-center text-xs wrap-anywhere text-neutral-500 dark:text-neutral-400"
        title={item.prompt}
      >
        {item.prompt}
      </p>
    </div>
  );
}
