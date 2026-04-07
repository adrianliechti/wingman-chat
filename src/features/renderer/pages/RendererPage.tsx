import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { getConfig } from "@/shared/config";
import { resizeImageBlob, readAsDataURL, decodeDataURL } from "@/shared/lib/utils";
import { X, ImagePlus, Download, PlusIcon, Info, Loader2, HardDrive } from "lucide-react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { DrivePicker, type SelectedFile } from "@/shared/ui/DrivePicker";
import { getDriveContentUrl } from "@/shared/lib/drives";
import DOMPurify from "dompurify";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { useDropZone } from "@/shared/hooks/useDropZone";
import { useImages } from "@/features/renderer/hooks/useImages";
import { RendererInput } from "@/features/renderer/components/RendererInput";
import type { Model } from "@/shared/types/chat";

const STYLE_INSTRUCTIONS: Record<string, string> = {
  // Photography styles
  Leica:
    "classic Leica rangefinder photograph with Summilux lens rendering, smooth creamy bokeh with gentle out-of-focus transitions, distinctive 3D pop and subject separation, beautiful highlight rolloff with subtle glow, natural micro-contrast and tack-sharp focus plane, authentic color rendering without oversaturation, shallow depth of field, 35mm or 50mm focal length perspective, natural available light, documentary street photography aesthetic",
  Polaroid:
    "instant Polaroid photograph aesthetic with characteristic white frame border, slightly washed-out colors with warm color shift, soft focus, subtle light leaks, nostalgic candid snapshot quality, slightly overexposed flash, square format composition, early 2000s party vibes",
  "B&W Studio":
    "professional black and white studio portrait photography, dramatic Rembrandt lighting with soft key light and deep shadows, high contrast tonal range, clean seamless backdrop, tack-sharp focus on eyes, elegant and timeless editorial aesthetic, rich silver gelatin print quality",
  Professional:
    "professional corporate photography in modern office environment, clean and polished look, natural window lighting with soft fill, shallow depth of field, business casual aesthetic, crisp detail, neutral color grading, LinkedIn profile quality",
  "Kodak Film":
    "vintage Kodak Portra 400 film photograph, warm golden tones, natural film grain, slightly lifted blacks, soft halation around highlights, authentic 35mm analog feel, candid composition, nostalgic color rendering with rich skin tones",
  Cinematic:
    "cinematic film still, anamorphic lens with subtle horizontal flare, teal and orange color grading, dramatic depth of field, 2.39:1 widescreen composition feel, volumetric lighting, atmospheric haze, Hollywood blockbuster production quality",
  Macro:
    "extreme macro photography, razor-thin depth of field with silky smooth bokeh, hyper-detailed textures at microscopic level, studio ring light with soft diffusion, crystal-clear sharpness on focal plane, vivid natural colors, scientific precision meets artistic beauty",

  // Artistic styles
  Ghibli:
    "in Studio Ghibli anime style, lush hand-painted watercolor backgrounds with extraordinary environmental detail, soft cel-shaded characters with gentle round features, warm nostalgic color palette with rich greens and dreamy skies, whimsical and serene atmosphere, Hayao Miyazaki aesthetic with sense of wonder and magic in everyday scenes",
  Anime:
    "in modern anime style with large expressive eyes, vibrant saturated colors, clean cel-shading with precise line art, soft gradient lighting, dynamic composition, characteristic Japanese animation aesthetics with detailed hair rendering and atmospheric effects",
  Watercolor:
    "in watercolor painting style with soft wet-on-wet blending, visible organic brushstrokes on textured cold-press paper, flowing pigments with beautiful bleeds, delicate transparent washes, areas of white paper showing through, spontaneous and luminous quality",
  "Oil Painting":
    "as a classical oil painting with rich impasto texture and visible palette knife work, deep saturated colors with luminous glazing layers, dramatic chiaroscuro lighting, old master composition techniques, canvas texture visible in thin passages",
  Sketch:
    "as a pencil sketch on cream paper with confident gestural lines, cross-hatching for tonal depth, visible construction lines and proportional guides, smudged graphite for soft shadows, loose artistic hand-drawn quality with raw energy",
  "Pop Art":
    "in pop art style with bold flat primary colors, halftone Ben-Day dots pattern, thick black outlines, high contrast graphic composition, inspired by Roy Lichtenstein and Andy Warhol, silk-screen print aesthetic with slight misregistration",
  "Ukiyo-e":
    "in traditional Japanese ukiyo-e woodblock print style, flat areas of bold color with black outlines, decorative wave and cloud patterns, elegant calligraphic line quality, Hokusai and Hiroshige inspired composition, handmade washi paper texture",
  "Comic Book":
    "in Western comic book illustration style, bold ink lines with dynamic hatching, vivid superhero-grade colors, dramatic foreshortening and action poses, CMYK halftone dot printing texture, speech bubble-ready composition, classic Marvel/DC aesthetic",
  "Art Deco":
    "in Art Deco style with bold geometric patterns, symmetrical composition, metallic gold and rich jewel-tone color palette, elegant streamlined forms, 1920s glamour aesthetic, Chrysler Building-inspired ornamental details, luxury and sophistication",

  // Commercial & Entertainment
  "Movie Poster":
    "cinematic movie poster design with dramatic three-point lighting, bold typography space reserved at top and bottom, high contrast with rich shadows, epic layered composition, Hollywood blockbuster aesthetic, theatrical one-sheet style with hero positioning",
  Sticker:
    "as a cute die-cut sticker design with thick white border outline, vibrant flat colors, slightly glossy finish, kawaii-inspired simplified forms, clean vector-sharp edges, perfect for laptop or water bottle, transparent background ready",
  "Chibi Crochet":
    "as an adorable chibi-style crocheted amigurumi doll, handmade yarn texture with visible individual stitches, big cute head with small body proportions, kawaii embroidered eyes, soft pastel yarn colors, cozy handcrafted plushie aesthetic, photographed on light background",
  Plushy:
    "as a cute plush toy with soft minky fabric texture, rounded puffy forms, embroidered eyes and details, visible seam stitching, huggable proportions with kawaii aesthetic, professional product photography lighting",

  // Digital & Tech styles
  Isometric:
    "in isometric pixel art style with precise 30-degree angles, no perspective distortion, clean geometric shapes, vibrant limited color palette, tiny detailed elements, video game diorama aesthetic, satisfying visual tidiness",
  "Pixel Art":
    "in retro pixel art style with strict limited 16-color palette, crisp hard-edged pixels, no anti-aliasing or smoothing, 16-bit SNES/Genesis video game aesthetic, dithering for gradients, nostalgic and charming",
  "Low Poly":
    "in low poly 3D render style with flat shaded triangular faces, geometric simplification of organic forms, subtle gradient coloring across faces, modern digital art aesthetic, clean minimal lighting, slightly glossy material",
  "3D Cartoon":
    "in Pixar/Disney 3D animation style, smooth subsurface scattering on skin, soft global illumination, appealing character proportions with slightly oversized head, rich detailed textures, vibrant color palette, professional studio render quality with subtle ambient occlusion",
  "Flat Vector":
    "in modern flat vector illustration style, clean geometric shapes with no outlines, limited harmonious color palette, minimal gradients, UI-friendly proportions, contemporary graphic design aesthetic, suitable for web and print, inspired by Kurzgesagt visual style",
  "Object Extract":
    "clean product photography style with pure white background, isolated subject with precise edge extraction, soft contact shadow only, professional e-commerce aesthetic, even studio lighting from all angles, transparent background ready",

  // Artistic movements
  Cyberpunk:
    "in cyberpunk style with vivid neon lights reflecting on rain-slicked streets, holographic displays and AR overlays, high-tech low-life aesthetic, dramatic purple and cyan color grading, volumetric fog with light rays, dense urban futuristic environment",
  Vaporwave:
    "in vaporwave aesthetic with pink and cyan gradients, Greek marble statue elements, retro computer graphics and grid patterns, palm tree silhouettes, 80s/90s nostalgic dreamscape, lo-fi VHS scan lines, Japanese text accents, surreal and melancholic beauty",
  Steampunk:
    "in steampunk style with intricate brass gears, copper pipes with verdigris patina, Victorian-era machinery and clockwork mechanisms, warm amber lighting, leather and rivets, industrial revolution meets fantasy, Jules Verne inspired aesthetic",
  Claymation:
    "in stop-motion claymation style, visible fingerprint impressions on smooth clay surfaces, slightly imperfect handmade charm, warm studio lighting with soft shadows, miniature set design with tactile textures, Aardman or Laika Studios inspired quality",
  Neon: "as a glowing neon sign against a dark background, bright luminous tube lighting with realistic glass tube bends, color bleeding and soft glow halos, subtle reflection on surface below, electric buzzing atmosphere, classic bar or storefront signage aesthetic",
};

const AVAILABLE_STYLES = Object.keys(STYLE_INSTRUCTIONS);

const blobs = [
  {
    bg: "radial-gradient(ellipse 80% 80% at center, rgba(120,119,198,0.18) 0%, transparent 70%)",
    top: "10%",
    left: "5%",
    w: "55%",
    h: "55%",
  },
  {
    bg: "radial-gradient(ellipse 80% 80% at center, rgba(255,119,198,0.14) 0%, transparent 70%)",
    top: "15%",
    left: "45%",
    w: "50%",
    h: "50%",
  },
  {
    bg: "radial-gradient(ellipse 80% 80% at center, rgba(78,205,196,0.14) 0%, transparent 70%)",
    top: "0%",
    left: "20%",
    w: "50%",
    h: "50%",
  },
  {
    bg: "radial-gradient(ellipse 70% 70% at center, rgba(255,177,66,0.12) 0%, transparent 70%)",
    top: "45%",
    left: "25%",
    w: "45%",
    h: "45%",
  },
] as const;

function CanvasBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {blobs.map((b, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            top: b.top,
            left: b.left,
            width: b.w,
            height: b.h,
            backgroundImage: b.bg,
          }}
        />
      ))}
    </div>
  );
}

// Memoized disclaimer component to avoid re-computing on every render
const Disclaimer = () => {
  const disclaimer = useMemo(() => {
    try {
      const config = getConfig();
      const sanitized = DOMPurify.sanitize(config.renderer?.disclaimer || "");
      return sanitized?.trim() || null;
    } catch {
      return null;
    }
  }, []);

  if (!disclaimer) return null;

  return (
    <div className="mb-6 mx-auto max-w-2xl">
      <div className="flex items-start justify-center gap-2 px-4 py-3">
        <Info size={16} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
        <p
          className="text-xs text-neutral-600 dark:text-neutral-400 text-left"
          dangerouslySetInnerHTML={{ __html: disclaimer }}
        />
      </div>
    </div>
  );
};

export function RendererPage() {
  const config = getConfig();
  const { setRightActions } = useNavigation();
  const { images, createImage, deleteImage } = useImages();

  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<{ blob: Blob; dataUrl: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeDrive, setActiveDrive] = useState<(typeof config.drives)[number] | null>(null);
  const [isFetchingDrive, setIsFetchingDrive] = useState(false);

  // Load available renderer models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const availableModels = await config.client.listModels("renderer");
        setModels(availableModels);

        // Set initial selected model from config or first available
        if (availableModels.length > 0) {
          const configuredModel = availableModels.find((m) => m.id === config.renderer?.model);
          setSelectedModel(configuredModel || availableModels[0]);
        }
      } catch (error) {
        console.error("Failed to load models:", error);
      }
    };

    loadModels();
  }, [config.client, config.renderer?.model]);

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
            const url = getDriveContentUrl(f.driveId, f.path);
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
        handleImageUpload(imageFiles);
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

      // Build the full prompt with style if selected
      const fullPrompt = selectedStyle
        ? `${activePrompt}${activePrompt.trim() ? ", " : ""}${STYLE_INSTRUCTIONS[selectedStyle]}`
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
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `generated-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
        <div className="flex-1 flex flex-col items-center min-h-0 p-4 pt-16 relative">
          {selectedImage ? (
            /* Image viewer — centered in space above the refine input */
            <div className="flex items-center justify-center flex-1 min-h-0 pb-24 w-full">
              {/* Inner wrapper sized to the image — loader and buttons anchor to this */}
              <div className="relative rounded-2xl shadow-xl overflow-hidden">
                <img
                  src={selectedImage.data}
                  alt={selectedImage.prompt || "Generated image"}
                  className="block max-w-full max-h-[calc(100vh-14rem)]"
                />

                {/* Loader overlay — covers only the image */}
                {isGenerating && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40 backdrop-blur-sm">
                    <Loader2 size={36} className="animate-spin text-white/80" />
                  </div>
                )}

                {/* Action buttons — always visible on touch, hover-reveal on desktop */}
                <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-100 md:opacity-0 md:hover:opacity-100 transition-opacity">
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

              <RendererInput
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
                availableStyles={AVAILABLE_STYLES}
                selectedStyle={selectedStyle}
                onSelectStyle={setSelectedStyle}
                placeholder="Generate something new..."
                disabled={isGenerating}
                autoFocus
              />
            </div>
          )}

          {/* Refine input — floating bottom center overlay */}
          {selectedImage && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
              <RendererInput
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
                availableStyles={AVAILABLE_STYLES}
                selectedStyle={selectedStyle}
                onSelectStyle={setSelectedStyle}
                placeholder="Refine the selected image..."
                disabled={isGenerating}
                className="pointer-events-auto"
              />
            </div>
          )}
        </div>

        {/* Thumbnail grid overlay — bottom horizontal on mobile, right vertical on desktop */}
        {images.length > 0 && (
          <div className="absolute bottom-20 inset-x-0 md:bottom-0 md:inset-auto md:top-16 md:right-0 z-10 flex md:flex-col items-center gap-2 p-2 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto scrollbar-hide">
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
                  onClick={() => {
                    setSelectedImageId(img.id);
                    setPrompt("");
                  }}
                  className={`relative size-16 md:size-20 rounded-xl overflow-hidden cursor-pointer group shrink-0 transition-all ${
                    isActive
                      ? "ring-2 ring-blue-500 dark:ring-blue-400 shadow-md"
                      : "border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500"
                  }`}
                >
                  <img src={img.data} alt={img.prompt || "Generated image"} className="size-full object-cover" />
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 size-4 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm"
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
              handleImageUpload(e.target.files);
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
