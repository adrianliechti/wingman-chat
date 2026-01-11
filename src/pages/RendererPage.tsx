import { useState, useRef, useCallback, useEffect } from "react";
import { getConfig } from "../config";
import { resizeImageBlob, readAsDataURL, decodeDataURL } from "../lib/utils";
import { X, ImagePlus, Sparkles, Download, PlusIcon, ArrowRight } from "lucide-react";
import { useNavigation } from "../hooks/useNavigation";
import { useLayout } from "../hooks/useLayout";
import { useDropZone } from "../hooks/useDropZone";
import { useImages } from "../hooks/useImages";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import type { Model } from "../types/chat";

export function RendererPage() {
  const config = getConfig();
  const { setRightActions } = useNavigation();
  const { layoutMode } = useLayout();
  const { images, createImage, deleteImage } = useImages();

  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<{ blob: Blob; preview: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [gridSize, setGridSize] = useState(3);
  
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

  const styleInstructions: Record<string, string> = {
    // Photography styles
    'Leica': 'classic Leica rangefinder photograph with Summilux lens rendering, smooth creamy bokeh with gentle out-of-focus transitions, distinctive 3D pop and subject separation, beautiful highlight rolloff with subtle glow, natural micro-contrast and tack-sharp focus plane, authentic color rendering without oversaturation, shallow depth of field, 35mm or 50mm focal length perspective, natural available light, documentary street photography aesthetic',
    'Polaroid': 'instant Polaroid photograph aesthetic with characteristic white frame border, slightly washed-out colors, soft focus, light leaks, vintage color shift, nostalgic amateur snapshot quality, square format composition',
    'B&W Studio': 'professional black and white studio portrait photography, dramatic lighting with soft shadows, high contrast, clean backdrop, sharp focus, elegant and timeless aesthetic, Ansel Adams inspired tonal range',
    'Professional': 'professional corporate photography in modern office environment, clean and polished look, natural window lighting, shallow depth of field, business casual aesthetic, LinkedIn profile quality',
    
    // Artistic styles
    'Isometric': 'in isometric pixel art style with 30-degree angles, no perspective distortion, clean geometric shapes, and video game diorama aesthetic',
    'Anime': 'in anime style with large expressive eyes, vibrant colors, clean cel-shading, soft gradients, and characteristic Japanese animation aesthetics',
    'Watercolor': 'in watercolor painting style with soft wet-on-wet blending, visible brushstrokes, paper texture, flowing pigments, and delicate transparent washes',
    'Oil Painting': 'as a classical oil painting with rich impasto texture, visible brushwork, deep saturated colors, and old master lighting techniques',
    'Sketch': 'as a pencil sketch with cross-hatching, visible construction lines, paper texture, and loose artistic hand-drawn quality',
    'Pop Art': 'in pop art style with bold primary colors, Ben-Day dots, thick black outlines, comic book aesthetics inspired by Roy Lichtenstein and Andy Warhol',
    
    // Commercial & Entertainment
    'Movie Poster': 'cinematic movie poster design with dramatic lighting, bold typography space, high contrast, epic composition, Hollywood blockbuster aesthetic, theatrical one-sheet style',
    'Chibi Crochet': 'as an adorable chibi-style crocheted amigurumi doll, handmade yarn texture, big cute head with small body proportions, kawaii button eyes, visible crochet stitches, soft pastel colors, handcrafted plushie aesthetic',
    'Plushy': 'as a cute plush toy with soft fabric texture, rounded forms, button eyes, stitching details, and huggable kawaii aesthetic',
    
    // Digital & Tech styles
    'Pixel Art': 'in retro pixel art style with limited color palette, crisp pixels, no anti-aliasing, 16-bit video game aesthetic',
    'Low Poly': 'in low poly 3D style with flat shaded triangular faces, geometric simplification, vibrant gradients, and modern digital art aesthetic',
    'Object Extract': 'clean product photography style with pure white background, isolated subject with precise edge extraction, professional e-commerce aesthetic, no shadows, transparent background ready',
    
    // Aesthetic movements
    'Cyberpunk': 'in cyberpunk style with neon lights, rain-slicked streets, holographic displays, high-tech low-life aesthetic, and dramatic purple and cyan color grading',
    'Vaporwave': 'in vaporwave aesthetic with pink and cyan gradients, Greek statues, retro computer graphics, palm trees, and 80s/90s nostalgia',
    'Steampunk': 'in steampunk style with brass gears, copper pipes, Victorian machinery, clockwork mechanisms, and industrial revolution meets fantasy aesthetic'
  };

  const availableStyles = Object.keys(styleInstructions);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Load available renderer models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const availableModels = await config.client.listModels("renderer");
        setModels(availableModels);
        
        // Set initial selected model from config or first available
        if (availableModels.length > 0) {
          const configuredModel = availableModels.find(m => m.id === config.renderer?.model);
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
    referenceImages.forEach(img => URL.revokeObjectURL(img.preview));
    setReferenceImages([]);
  }, [referenceImages]);

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
      </button>
    );

    return () => {
      setRightActions(null);
    };
  }, [setRightActions, handleReset]);

  const handleImageUpload = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith("image/"));
    
    for (const file of imageFiles) {
      if (referenceImages.length >= 4) {
        break;
      }
      
      try {
        const resizedBlob = await resizeImageBlob(file, 1024, 1024);
        const preview = URL.createObjectURL(resizedBlob);
        
        setReferenceImages(prev => {
          if (prev.length >= 4) {
            URL.revokeObjectURL(preview);
            return prev;
          }
          return [...prev, { blob: resizedBlob, preview }];
        });
      } catch (err) {
        console.error("Failed to process image:", err);
      }
    }
  }, [referenceImages.length]);

  const removeReferenceImage = useCallback((index: number) => {
    setReferenceImages(prev => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  const addAsReference = useCallback(async (id: string) => {
    if (referenceImages.length >= 4) {
      return;
    }

    const generatedImage = images.find(img => img.id === id);
    if (!generatedImage) {
      return;
    }

    try {
      const blob = decodeDataURL(generatedImage.data);
      const resizedBlob = await resizeImageBlob(blob, 1024, 1024);
      const preview = URL.createObjectURL(resizedBlob);
      
      setReferenceImages(prev => {
        if (prev.length >= 4) {
          URL.revokeObjectURL(preview);
          return prev;
        }
        return [...prev, { blob: resizedBlob, preview }];
      });
    } catch (err) {
      console.error("Failed to use image as reference:", err);
    }
  }, [images, referenceImages.length]);

  const handleDropFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      handleImageUpload(imageFiles);
    }
  }, [handleImageUpload]);

  const isDragging = useDropZone(containerRef, handleDropFiles);

  const handleGenerate = async () => {
    if (!prompt.trim() && referenceImages.length === 0) {
      return;
    }

    setIsGenerating(true);
    setGridSize(3);

    gridIntervalRef.current = setInterval(() => {
      setGridSize(prev => prev + 1);
    }, 2000);

    try {
      const model = selectedModel?.id || config.renderer?.model || "";
      const images = referenceImages.map(img => img.blob);
      
      // Build the full prompt with style if selected
      const fullPrompt = selectedStyle 
        ? `${prompt}${prompt.trim() ? ', ' : ''}${styleInstructions[selectedStyle]}`
        : prompt;
      
      const resultBlob = await config.client.generateImage(model, fullPrompt, images.length > 0 ? images : undefined);
      
      // Convert to data URL for persistence and display
      const dataUrl = await readAsDataURL(resultBlob);
      
      // Add to persisted images via hook
      createImage({
        prompt: fullPrompt,
        model: model,
        data: dataUrl,
      });
    } catch (err) {
      console.error("Image generation failed:", err);
    } finally {
      if (gridIntervalRef.current) {
        clearInterval(gridIntervalRef.current);
        gridIntervalRef.current = null;
      }
      setIsGenerating(false);
      setGridSize(3);
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

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
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
  }, [handleImageUpload]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      <main 
        ref={containerRef}
        className="w-full grow overflow-hidden flex p-4 pt-20 relative"
      >
        {/* Full-screen drop zone overlay */}
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center z-30 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-sm">
            <div className="relative bg-neutral-50/60 dark:bg-neutral-900/50 backdrop-blur-lg p-10 rounded-2xl shadow-xl border-2 border-dashed border-neutral-300 dark:border-neutral-600 flex flex-col items-center gap-5">
              <ImagePlus size={64} className="text-neutral-400 dark:text-neutral-500" />
              <span className="text-base font-medium text-neutral-500 dark:text-neutral-400 text-center">
                Drop images as reference
              </span>
            </div>
          </div>
        )}

        <div className={`w-full h-full ${
          layoutMode === 'wide' 
            ? 'max-w-full mx-auto' 
            : 'max-w-300 mx-auto'
        }`}>
          <div className="relative h-full w-full overflow-hidden">
            {/* 50/50 split layout */}
            <div className="h-full flex flex-col md:flex-row min-h-0 transition-all duration-200">
              {/* Left: Input section */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                {/* Model selector at top - always rendered to avoid flickering */}
                <div className="shrink-0 px-3 pt-2">
                  <Menu>
                    <MenuButton className="inline-flex items-center gap-1 pl-1 pr-2 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-sm transition-colors">
                      <Sparkles size={14} />
                      <span>{selectedModel?.name || 'Image Model'}</span>
                    </MenuButton>
                    <MenuItems
                      modal={false}
                      transition
                      anchor="bottom start"
                      className="mt-2 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50"
                    >
                      {models.length === 0 ? (
                        <div className="px-4 py-2 text-neutral-500 dark:text-neutral-400 text-sm">
                          Loading models...
                        </div>
                      ) : (
                        models.map((model) => (
                          <MenuItem key={model.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedModel(model)}
                              className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors"
                            >
                              {model.name}
                            </button>
                          </MenuItem>
                        ))
                      )}
                    </MenuItems>
                  </Menu>
                </div>

                {/* Scrollable content area */}
                <div className="flex-1 overflow-y-auto min-h-0 flex flex-col px-4 pt-2 pb-3">
                  <textarea
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      // Auto-resize textarea
                      const target = e.target;
                      target.style.height = 'auto';
                      target.style.height = `${target.scrollHeight}px`;
                    }}
                    onPaste={handlePaste}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe the image you want to generate..."
                    className="w-full min-h-6 bg-transparent border-none resize-none text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none"
                  />

                  {/* Reference images below text */}
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {referenceImages.map((img, index) => (
                      <div
                        key={index}
                        className="relative size-16 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-lg border border-white/40 dark:border-white/25 shadow-sm flex items-center justify-center group hover:shadow-md hover:border-white/60 dark:hover:border-white/40 transition-all"
                        title="Reference image"
                      >
                        <img
                          src={img.preview}
                          alt={`Reference ${index + 1}`}
                          className="size-full object-cover rounded-lg"
                        />
                        <button
                          type="button"
                          className="absolute -top-1 -right-1 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
                          onClick={() => removeReferenceImage(index)}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    
                    {referenceImages.length < 4 && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="size-16 bg-white/30 dark:bg-neutral-800/60 backdrop-blur-lg rounded-lg border-2 border-dashed border-white/50 dark:border-white/30 shadow-sm flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:border-white/70 dark:hover:border-white/50 hover:shadow-md transition-all"
                        title="Add reference image"
                      >
                        <ImagePlus size={18} />
                      </button>
                    )}
                  </div>

                  {/* Style selector */}
                  <div className="flex flex-wrap gap-1.5 mt-6">
                    {availableStyles.map((style) => {
                      const isSelected = selectedStyle === style;
                      return (
                        <button
                          type="button"
                          key={style}
                          onClick={() => setSelectedStyle(isSelected ? null : style)}
                          className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-600'
                              : 'bg-neutral-50 dark:bg-neutral-800/40 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700/60'
                          }`}
                        >
                          {style}
                        </button>
                      );
                    })}
                  </div>
                </div>

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
              </div>

              {/* Divider with Generate Button */}
              <div className="relative flex items-center justify-center py-2 md:py-0 md:w-14 shrink-0">
                <div className="absolute md:inset-y-0 md:w-px md:left-1/2 md:-translate-x-px inset-x-0 h-px md:h-auto bg-black/20 dark:bg-white/20"></div>
                
                {/* Generate button centered on divider - only show when input available and not generating */}
                {(prompt.trim() || referenceImages.length > 0) && !isGenerating && (
                  <button
                    type="button"
                    onClick={handleGenerate}
                    className="relative z-20 size-11 rounded-full bg-white dark:bg-neutral-950 border border-black/20 dark:border-white/20 text-neutral-500 dark:text-neutral-400 transition-all duration-200 hover:border-black/40 dark:hover:border-white/40 hover:text-neutral-700 dark:hover:text-neutral-200 hover:scale-105 active:scale-95 flex items-center justify-center"
                    title={`Generate (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter)`}
                  >
                    <ArrowRight size={18} className="rotate-90 md:rotate-0" />
                  </button>
                )}
              </div>

              {/* Right: Output section */}
              <div className="flex-1 flex flex-col relative min-w-0 min-h-0 overflow-hidden">
                <div className="absolute inset-0 overflow-y-auto">
                  <div className="flex flex-wrap gap-3 content-start p-4 pt-12">
                  {/* Generation placeholder - shown first while generating */}
                  {isGenerating && (
                    <div className="relative w-40 h-40 rounded-xl overflow-hidden shadow-sm bg-neutral-100 dark:bg-neutral-900">
                      {/* Animated grid */}
                      <svg 
                        className="absolute inset-0 w-full h-full opacity-10 transition-opacity duration-300" 
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                      >
                        {Array.from({ length: gridSize }, (_, row) =>
                          Array.from({ length: gridSize }, (_, col) => {
                            const isEvenSquare = (row + col) % 2 === 0;
                            const cellSize = 100 / gridSize;
                            return (
                              <rect
                                key={`${row}-${col}`}
                                x={col * cellSize}
                                y={row * cellSize}
                                width={cellSize}
                                height={cellSize}
                                className={isEvenSquare ? "fill-neutral-800 dark:fill-neutral-700" : "fill-neutral-900 dark:fill-neutral-800"}
                              />
                            );
                          })
                        ).flat()}
                      </svg>
                    </div>
                  )}

                  {/* Generated images (newest first) */}
                  {images.map((img) => (
                    <div
                      key={img.id}
                      className="relative w-40 h-40 bg-white/40 dark:bg-black/25 backdrop-blur-lg rounded-xl border border-white/40 dark:border-white/25 shadow-sm flex items-center justify-center group hover:shadow-md hover:border-white/60 dark:hover:border-white/40 transition-all cursor-pointer"
                      onClick={() => handleDownload(img.data)}
                      title={img.prompt || undefined}
                    >
                      <img
                        src={img.data}
                        alt={img.prompt || 'Generated image'}
                        className="size-full object-cover rounded-xl"
                      />
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 size-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteImage(img.id);
                        }}
                      >
                        <X size={10} />
                      </button>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addAsReference(img.id);
                          }}
                          disabled={referenceImages.length >= 4}
                          className="p-1.5 bg-white/90 dark:bg-neutral-900/90 text-neutral-800 dark:text-neutral-200 rounded-lg hover:bg-white dark:hover:bg-neutral-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Use as reference"
                        >
                          <ImagePlus size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(img.data);
                          }}
                          className="p-1.5 bg-white/90 dark:bg-neutral-900/90 text-neutral-800 dark:text-neutral-200 rounded-lg hover:bg-white dark:hover:bg-neutral-800 transition-all"
                          title="Download"
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>

                {/* Empty State */}
                {images.length === 0 && !isGenerating && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                        <Sparkles size={28} className="text-neutral-400 dark:text-neutral-500" />
                      </div>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        Describe an image to generate
                      </p>
                      <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-1">
                        Results will appear here
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
