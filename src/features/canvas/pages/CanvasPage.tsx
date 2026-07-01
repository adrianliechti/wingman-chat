import { Download, ImagePlus, Info, Loader2, PlusIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasInput } from "@/features/canvas/components/CanvasInput";
import { useImageStyles } from "@/features/canvas/hooks/useImageStyles";
import { useImages } from "@/features/canvas/hooks/useImages";
import { useRendererModels } from "@/features/canvas/hooks/useRendererModels";
import { getConfig } from "@/shared/config";
import { useDropZone } from "@/shared/hooks/useDropZone";
import { cn } from "@/shared/lib/cn";
import { getDriveContentUrl } from "@/shared/lib/drives";
import { sanitizeHtmlToReact } from "@/shared/lib/htmlToReact";
import { decodeDataURL, downloadFromUrl, readAsDataURL, resizeImageBlob } from "@/shared/lib/utils";
import type { ImageBackground, ImageQuality, ImageResolution, Model } from "@/shared/types/chat";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { useNavigation } from "@/shell/hooks/useNavigation";

function CanvasBackground() {
  const mask = "radial-gradient(ellipse at center, black 40%, transparent 85%)";
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    >
      {/* Light mode dots */}
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          backgroundImage: "radial-gradient(rgb(0 0 0 / 0.08) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      {/* Dark mode dots */}
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

// Memoized disclaimer component to avoid re-computing on every render
const Disclaimer = () => {
  const disclaimer = useMemo(() => {
    try {
      const config = getConfig();
      return config.renderer?.disclaimer?.trim()
        ? sanitizeHtmlToReact(config.renderer.disclaimer, { keyPrefix: "canvas-disclaimer" })
        : null;
    } catch {
      return null;
    }
  }, []);

  if (!disclaimer) return null;

  return (
    <div className="mb-6 mx-auto max-w-2xl">
      <div className="flex items-start justify-center gap-2 px-4 py-3">
        <Info size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
        <div className="text-xs text-neutral-600 dark:text-neutral-400 text-left">{disclaimer}</div>
      </div>
    </div>
  );
};

export function CanvasPage() {
  const config = getConfig();
  const { setRightActions } = useNavigation();
  const { images, createImage, deleteImage } = useImages();

  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<{ blob: Blob; dataUrl: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const models = useRendererModels();
  const { styles: imageStyles, prompts: stylePrompts } = useImageStyles();
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedAspect, setSelectedAspect] = useState<string | null>(null);
  // Canvas images are crafted and kept, so default to medium (the production
  // baseline); the chat create_image tool defaults to low for casual asks. Users
  // can still pick low/high/Auto from the submenu.
  const [selectedQuality, setSelectedQuality] = useState<ImageQuality | null>("medium");
  const [selectedResolution, setSelectedResolution] = useState<ImageResolution | null>(null);
  const [selectedBackground, setSelectedBackground] = useState<ImageBackground | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);
  const [isFetchingDrive, setIsFetchingDrive] = useState(false);

  // Pick an initial model once the list loads: the configured renderer, else the
  // first available.
  useEffect(() => {
    if (selectedModel || models.length === 0) return;
    const configured = models.find((m) => m.id === config.renderer?.model);
    setSelectedModel(configured ?? models[0]);
  }, [models, selectedModel, config.renderer?.model]);

  // Drop any aspect/quality/background selection the chosen model doesn't support,
  // so we never send it an option it can't honor.
  useEffect(() => {
    if (!selectedModel) return;
    if (selectedAspect && !selectedModel.supportedAspectRatios?.includes(selectedAspect)) setSelectedAspect(null);
    if (selectedQuality && !selectedModel.supportedQualities?.includes(selectedQuality)) setSelectedQuality(null);
    if (selectedResolution && !selectedModel.supportedResolutions?.includes(selectedResolution)) {
      setSelectedResolution(null);
    }
    if (selectedBackground && !selectedModel.supportedBackgrounds?.includes(selectedBackground)) {
      setSelectedBackground(null);
    }
  }, [selectedModel, selectedAspect, selectedQuality, selectedResolution, selectedBackground]);

  const handleReset = useCallback(() => {
    setPrompt("");
    setReferenceImages([]);
    setSelectedStyle(null);
    setSelectedImageId(null);
  }, []);

  // Set up navigation actions
  useEffect(() => {
    setRightActions(
      <button
        type="button"
        className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
        onClick={handleReset}
        title="Clear"
      >
        <PlusIcon size={20} />
      </button>,
    );

    return () => {
      setRightActions(null);
    };
  }, [setRightActions, handleReset]);

  const handleImageUpload = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));

    for (const file of imageFiles) {
      try {
        const resizedBlob = await resizeImageBlob(file, 1024, 1024);
        const dataUrl = await readAsDataURL(resizedBlob);

        let added = false;
        setReferenceImages((prev) => {
          if (prev.length >= 4) {
            return prev;
          }
          added = true;
          return [...prev, { blob: resizedBlob, dataUrl }];
        });
        if (!added) {
          break;
        }
      } catch (err) {
        console.error("Failed to process image:", err);
      }
    }
  }, []);

  const handleDriveFiles = useCallback(
    async (files: SelectedFile[]) => {
      setIsFetchingDrive(true);
      try {
        const fetched = await Promise.all(
          files.map(async (f) => {
            const url = getDriveContentUrl(f.driveId, f.id);
            const resp = await fetch(url);
            const blob = await resp.blob();
            return new File([blob], f.name, { type: f.mime || blob.type });
          }),
        );
        await handleImageUpload(fetched);
      } finally {
        setIsFetchingDrive(false);
      }
    },
    [handleImageUpload],
  );

  const removeReferenceImage = useCallback((index: number) => {
    setReferenceImages((prev) => {
      const newImages = [...prev];
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  const addAsReference = useCallback(
    async (id: string) => {
      if (referenceImages.length >= 4) {
        return;
      }

      const generatedImage = images.find((img) => img.id === id);
      if (!generatedImage) {
        return;
      }

      try {
        const blob = decodeDataURL(generatedImage.data);
        const resizedBlob = await resizeImageBlob(blob, 1024, 1024);
        const dataUrl = await readAsDataURL(resizedBlob);

        setReferenceImages((prev) => {
          if (prev.length >= 4) {
            return prev;
          }
          return [...prev, { blob: resizedBlob, dataUrl }];
        });
      } catch (err) {
        console.error("Failed to use image as reference:", err);
      }
    },
    [images, referenceImages.length],
  );

  const handleDropFiles = useCallback(
    (files: File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        void handleImageUpload(imageFiles);
      }
    },
    [handleImageUpload],
  );

  const isDragging = useDropZone(containerRef, handleDropFiles);

  const handleGenerate = async (overridePrompt?: string, sourceImageData?: string) => {
    const activePrompt = overridePrompt ?? prompt;
    if (!activePrompt.trim() && referenceImages.length === 0) {
      return;
    }

    setIsGenerating(true);

    // Capture and clear reference images
    const currentRefImages = referenceImages;
    setReferenceImages([]);

    try {
      const model = selectedModel?.id || config.renderer?.model || "";

      // Build the full prompt with style if selected. The style may no longer
      // exist if the served skill changed under us, so guard the lookup.
      const styleFragment = selectedStyle ? stylePrompts[selectedStyle] : undefined;
      const fullPrompt = styleFragment
        ? `${activePrompt}${activePrompt.trim() ? ", " : ""}${styleFragment}`
        : activePrompt;

      // Collect reference images: user-uploaded + optionally the source image for refinement
      const refImages: Blob[] = currentRefImages.map((img) => img.blob);
      if (sourceImageData) {
        refImages.push(decodeDataURL(sourceImageData));
      }

      const resultBlob = await config.client.generateImage(
        model,
        fullPrompt,
        refImages.length > 0 ? refImages : undefined,
        {
          aspectRatio: selectedAspect ?? undefined,
          quality: selectedQuality ?? undefined,
          resolution: selectedResolution ?? undefined,
          background: selectedBackground ?? undefined,
        },
      );

      // Convert to data URL for persistence and display
      const dataUrl = await readAsDataURL(resultBlob);

      // Add to persisted images via hook
      const newImage = await createImage({
        prompt: fullPrompt,
        model: model,
        data: dataUrl,
      });

      setSelectedImageId(newImage.id);
      setPrompt("");
    } catch (err) {
      console.error("Image generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = (imageUrl: string) => {
    downloadFromUrl(imageUrl, `generated-${Date.now()}.png`);
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const imageFiles: File[] = [];

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        await handleImageUpload(imageFiles);
      }
    },
    [handleImageUpload],
  );

  // Derive the selected image object
  const selectedImage = useMemo(
    () => (selectedImageId ? (images.find((img) => img.id === selectedImageId) ?? null) : null),
    [images, selectedImageId],
  );

  // Auto-select first image if selected image was deleted
  useEffect(() => {
    if (selectedImageId && !selectedImage && images.length > 0) {
      setSelectedImageId(images[0].id);
    } else if (selectedImageId && images.length === 0) {
      setSelectedImageId(null);
    }
  }, [images, selectedImageId, selectedImage]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      <main ref={containerRef} className="w-full grow overflow-hidden flex flex-col relative">
        {/* Full-screen drop zone overlay */}
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center z-30 bg-slate-50/80 dark:bg-slate-900/40 backdrop-blur-sm">
            <div className="relative bg-neutral-50/60 dark:bg-neutral-900/50 backdrop-blur-lg p-10 rounded-2xl shadow-xl border-2 border-dashed border-slate-400 dark:border-slate-500 flex flex-col items-center gap-5">
              <ImagePlus size={64} className="text-neutral-400 dark:text-neutral-500" />
              <span className="text-base font-medium text-neutral-500 dark:text-neutral-400 text-center">
                Drop images as reference
              </span>
            </div>
          </div>
        )}

        {/* Main content — centered on full page width */}
        <div
          className={cn(
            "flex-1 flex flex-col items-center min-h-0 p-4 pt-8 md:pt-16 relative",
            images.length > 0 && "md:px-24",
          )}
        >
          {selectedImage ? (
            /* Image viewer — centered in space above the refine input */
            <div className="flex items-center justify-center flex-1 min-h-0 pb-44 md:pb-28 w-full">
              {/* Inner wrapper sized to the image — loader and buttons anchor to this */}
              <div className="relative rounded-2xl shadow-xl overflow-hidden">
                <img
                  src={selectedImage.data}
                  alt={selectedImage.prompt || "Generated image"}
                  className="block max-w-full max-h-[calc(100svh-22rem)] md:max-h-[calc(100vh-14rem)]"
                />

                {/* Loader overlay — covers only the image */}
                {isGenerating && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40 backdrop-blur-sm">
                    <Loader2 size={36} className="animate-spin text-white/80" />
                  </div>
                )}

                {/* Action buttons — always visible on touch, hover-reveal on desktop */}
                <div className="absolute top-2 right-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => addAsReference(selectedImage.id)}
                    disabled={referenceImages.length >= 4}
                    className="p-2 bg-black/40 hover:bg-black/60 backdrop-blur-lg text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Use as reference"
                  >
                    <ImagePlus size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(selectedImage.data)}
                    className="p-2 bg-black/40 hover:bg-black/60 backdrop-blur-lg text-white rounded-lg transition-all"
                    title="Download"
                  >
                    <Download size={16} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Empty / prompt-only state */
            <div className="flex flex-col items-center justify-center gap-5 w-full flex-1 relative">
              <CanvasBackground />
              <Disclaimer />

              {isGenerating && (
                <div className="relative w-64 h-64 md:w-72 md:h-72 rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-900 shadow-lg mb-2">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 size={32} className="animate-spin text-neutral-400 dark:text-neutral-500" />
                  </div>
                </div>
              )}

              <CanvasInput
                prompt={prompt}
                onPromptChange={setPrompt}
                onSubmit={() => handleGenerate()}
                onPaste={handlePaste}
                referenceImages={referenceImages}
                onRemoveReferenceImage={removeReferenceImage}
                onFileUploadClick={() => fileInputRef.current?.click()}
                drives={config.drives}
                onDriveSelect={setActiveDrive}
                isLoadingFiles={isFetchingDrive}
                models={models}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                styles={imageStyles}
                selectedStyle={selectedStyle}
                onSelectStyle={setSelectedStyle}
                selectedAspect={selectedAspect}
                onSelectAspect={setSelectedAspect}
                selectedQuality={selectedQuality}
                onSelectQuality={setSelectedQuality}
                selectedResolution={selectedResolution}
                onSelectResolution={setSelectedResolution}
                selectedBackground={selectedBackground}
                onSelectBackground={setSelectedBackground}
                placeholder="Generate something new..."
                disabled={isGenerating}
                autoFocus
                className="max-w-4xl"
              />
            </div>
          )}

          {/* Refine input — floating bottom center overlay */}
          {selectedImage && (
            <div className="pointer-events-none absolute inset-x-0 bottom-24 md:bottom-6 z-20 flex justify-center px-4">
              <CanvasInput
                prompt={prompt}
                onPromptChange={setPrompt}
                onSubmit={() => handleGenerate(undefined, selectedImage.data)}
                onPaste={handlePaste}
                referenceImages={referenceImages}
                onRemoveReferenceImage={removeReferenceImage}
                onFileUploadClick={() => fileInputRef.current?.click()}
                drives={config.drives}
                onDriveSelect={setActiveDrive}
                isLoadingFiles={isFetchingDrive}
                models={models}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                styles={imageStyles}
                selectedStyle={selectedStyle}
                onSelectStyle={setSelectedStyle}
                selectedAspect={selectedAspect}
                onSelectAspect={setSelectedAspect}
                selectedQuality={selectedQuality}
                onSelectQuality={setSelectedQuality}
                selectedResolution={selectedResolution}
                onSelectResolution={setSelectedResolution}
                selectedBackground={selectedBackground}
                onSelectBackground={setSelectedBackground}
                placeholder="Refine the selected image..."
                disabled={isGenerating}
                className="pointer-events-auto max-w-4xl"
              />
            </div>
          )}
        </div>

        {/* Thumbnail grid overlay — bottom horizontal on mobile, right vertical on desktop */}
        {images.length > 0 && (
          <div className="absolute bottom-0 inset-x-0 md:bottom-0 md:inset-auto md:top-16 md:right-0 z-10 flex md:flex-col items-center gap-2 p-2 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto scrollbar-none bg-white/50 dark:bg-neutral-950/50 md:bg-transparent dark:md:bg-transparent backdrop-blur-sm md:backdrop-blur-none">
            {/* New generation tile */}
            <button
              type="button"
              onClick={() => {
                setSelectedImageId(null);
                setPrompt("");
              }}
              className={`size-16 md:size-20 rounded-xl border-2 border-dashed flex items-center justify-center transition-all shrink-0 ${
                !selectedImageId
                  ? "border-blue-400 dark:border-blue-500 text-blue-500 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-900/20"
                  : "border-neutral-300 dark:border-neutral-600 text-neutral-400 dark:text-neutral-500 hover:border-neutral-400 dark:hover:border-neutral-500 hover:text-neutral-500 dark:hover:text-neutral-400 bg-white/60 dark:bg-neutral-900/60"
              } backdrop-blur-lg`}
              title="Generate new image"
            >
              <PlusIcon size={20} />
            </button>

            {/* Image thumbnails */}
            {images.map((img) => {
              const isActive = img.id === selectedImageId;
              return (
                <div
                  key={img.id}
                  className={`relative size-16 md:size-20 rounded-xl cursor-pointer group shrink-0 transition-all ${
                    isActive
                      ? "ring-2 ring-blue-500 dark:ring-blue-400 shadow-md"
                      : "border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedImageId(img.id);
                      setPrompt("");
                    }}
                    className="block size-full overflow-hidden rounded-xl"
                    aria-pressed={isActive}
                    title={img.prompt || "Select generated image"}
                  >
                    <img src={img.data} alt={img.prompt || "Generated image"} className="size-full object-cover" />
                  </button>
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 z-10 size-4 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteImage(img.id);
                    }}
                  >
                    <X size={8} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            if (e.target.files) {
              void handleImageUpload(e.target.files);
              e.target.value = "";
            }
          }}
          className="hidden"
        />
      </main>

      {activeDrive && (
        <DrivePicker
          isOpen={!!activeDrive}
          onClose={() => setActiveDrive(null)}
          drive={activeDrive}
          onFilesSelected={handleDriveFiles}
          multiple
          accept="image/*"
        />
      )}
    </div>
  );
}
