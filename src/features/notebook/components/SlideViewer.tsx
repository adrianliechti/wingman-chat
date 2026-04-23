import { Loader2, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getConfig } from "@/shared/config";
import { getTextFromContent } from "@/shared/types/chat";
import type { NotebookOutput } from "../types/notebook";

interface SlideViewerProps {
  output: NotebookOutput;
  onRefine?: (updatedOutput: NotebookOutput) => void;
}

export function SlideViewer({ output, onRefine }: SlideViewerProps) {
  const htmlSlides = output.htmlSlides;
  const slides = output.slides ?? [];
  const isGenerating = output.status === "generating";
  const slideCount = htmlSlides?.length ?? slides.length;

  const [activeIndex, setActiveIndex] = useState(1);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  const thumbnails = useSlideThumbnails(htmlSlides);

  // Reset to slide 1 when switching to a different output
  useEffect(() => {
    setActiveIndex(1);
  }, [output.id]);

  // Auto-follow the latest slide during generation
  const prevSlideCount = useRef(slideCount);
  useEffect(() => {
    if (isGenerating && slideCount > prevSlideCount.current) {
      setActiveIndex(slideCount);
    }
    prevSlideCount.current = slideCount;
  }, [slideCount, isGenerating]);

  // Auto-scroll thumbnail bar to keep latest visible
  const thumbBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isGenerating && thumbBarRef.current) {
      thumbBarRef.current.scrollLeft = thumbBarRef.current.scrollWidth;
    }
  }, [slideCount, isGenerating]);

  // Scale iframe to fit container
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const [slideScale, setSlideScale] = useState(1);

  useEffect(() => {
    const el = slideContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const cw = entry.contentRect.width;
      const ch = entry.contentRect.height;
      setSlideScale(Math.min(cw / 1920, ch / 1080));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleRefineSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!refinePrompt.trim() || isRefining || activeIndex < 1) return;

    const slideIdx = activeIndex - 1;
    setIsRefining(true);
    setRefineError(null);

    try {
      const config = getConfig();
      const client = config.client;
      const model = config.notebook?.model || "";

      if (htmlSlides?.[slideIdx]) {
        const result = await client.complete(
          model,
          `You are refining a single HTML slide. The slide is a self-contained HTML document (1920x1080px, 16:9). Apply the user's refinement request. Return ONLY the complete updated HTML document.`,
          [
            { role: "user", content: [{ type: "text", text: `Current slide HTML:\n\n${htmlSlides[slideIdx]}\n\nRefinement request: ${refinePrompt.trim()}` }] },
          ],
          [],
        );

        const newHtml = getTextFromContent(result.content);
        if (newHtml?.trim()) {
          const cleaned = newHtml
            .replace(/^```html?\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();
          const updated = [...htmlSlides];
          updated[slideIdx] = cleaned;
          onRefine?.({ ...output, htmlSlides: updated });
        }
      } else if (slides[slideIdx]) {
        const rendererModel = config.renderer?.model || "";
        const slideTexts = output.content.split(/\n\n---\n\n/);
        const slideText = slideTexts[slideIdx] || "";

        const result = await client.complete(
          model,
          `You are generating an image prompt for a presentation slide. Based on the slide content and refinement request, create a detailed image generation prompt. Return ONLY the prompt. End with "16:9 aspect ratio."`,
          [
            { role: "user", content: [{ type: "text", text: `Slide content:\n${slideText}\n\nRefinement request: ${refinePrompt.trim()}` }] },
          ],
          [],
        );

        const imagePrompt = getTextFromContent(result.content);
        if (imagePrompt?.trim()) {
          const { blobToDataUrl } = await import("@/shared/lib/opfs-core");
          const imageBlob = await client.generateImage(rendererModel, imagePrompt.trim());
          const imageUrl = await blobToDataUrl(imageBlob);
          const updated = [...slides];
          updated[slideIdx] = imageUrl;
          onRefine?.({ ...output, slides: updated });
        }
      }

      setRefinePrompt("");
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setIsRefining(false);
    }
  };

  // Determine what to show in the main view
  const currentSlideHtml = htmlSlides?.[activeIndex - 1];
  const currentSlideImg = slides[activeIndex - 1];

  return (
    <div className="h-full flex flex-col">
      {/* Main view */}
      <div className="flex-1 overflow-y-auto min-h-0 relative">
        {currentSlideHtml ? (
          <div className="h-full flex items-center justify-center p-6" ref={slideContainerRef}>
            <div
              className="rounded-lg shadow-lg overflow-hidden bg-white"
              style={{ width: 1920 * slideScale, height: 1080 * slideScale }}
            >
              <iframe
                srcDoc={currentSlideHtml}
                style={{
                  width: 1920,
                  height: 1080,
                  border: "none",
                  transform: `scale(${slideScale})`,
                  transformOrigin: "top left",
                }}
                sandbox="allow-scripts"
                title={`Slide ${activeIndex}`}
              />
            </div>
          </div>
        ) : currentSlideImg ? (
          <div className="h-full flex items-center justify-center p-6">
            <img src={currentSlideImg} alt={`Slide ${activeIndex}`} className="max-w-full max-h-full rounded-lg shadow-lg" />
          </div>
        ) : isGenerating ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
            <Loader2 size={32} className="animate-spin text-neutral-300" />
            <span className="text-sm text-neutral-400">Generating slides...</span>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <span className="text-sm text-neutral-400">No slides</span>
          </div>
        )}

        {/* Floating refine prompt */}
        {slideCount > 0 && (
          <div className="absolute bottom-4 left-4 right-4 z-20">
            <form onSubmit={handleRefineSubmit}>
              <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-neutral-700/40 shadow-lg shadow-black/5 dark:shadow-black/20 p-3">
                <input
                  type="text"
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  placeholder="Refine this slide..."
                  disabled={isRefining || isGenerating}
                  className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={!refinePrompt.trim() || isRefining || isGenerating}
                  className="p-1.5 rounded-lg bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-800 disabled:opacity-30 transition-opacity"
                >
                  {isRefining ? <Loader2 size={14} className="animate-spin" /> : <SparklesIcon size={14} />}
                </button>
              </div>
              {refineError && (
                <p className="text-[10px] text-red-500 mt-1 px-3">{refineError}</p>
              )}
            </form>
          </div>
        )}
      </div>

      {/* Bottom thumbnail navigation */}
      <div className="shrink-0 overflow-x-auto px-3 py-2" ref={thumbBarRef}>
        <div className="flex items-center gap-2">
          {(htmlSlides ?? []).map((_, i) => (
            <button
              key={`slide-${i}`}
              type="button"
              onClick={() => setActiveIndex(i + 1)}
              className={`shrink-0 w-20 aspect-[16/9] rounded-lg border-2 overflow-hidden transition-colors bg-neutral-100 dark:bg-neutral-800 ${
                activeIndex === i + 1
                  ? "border-blue-500"
                  : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
              }`}
            >
              {thumbnails[i] ? (
                <img src={thumbnails[i]} alt={`Slide ${i + 1}`} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[9px] font-medium text-neutral-400 flex items-center justify-center h-full">{i + 1}</span>
              )}
            </button>
          ))}
          {!htmlSlides?.length && slides.map((slideUrl, i) => (
            <button
              key={`img-slide-${i}`}
              type="button"
              onClick={() => setActiveIndex(i + 1)}
              className={`shrink-0 w-20 aspect-[16/9] rounded-lg border-2 overflow-hidden transition-colors ${
                activeIndex === i + 1
                  ? "border-blue-500"
                  : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
              }`}
            >
              <img src={slideUrl} alt={`Slide ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
          {isGenerating && (
            <div style={{ width: 80, height: 45, flexShrink: 0 }} className="rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 flex items-center justify-center bg-neutral-100 dark:bg-neutral-800">
              <Loader2 size={12} className="animate-spin text-neutral-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Render HTML slides to small image data URLs one-by-one using a single
 * off-screen iframe + canvas. Much lighter than mounting N iframes.
 */
function useSlideThumbnails(htmlSlides?: string[]): string[] {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const slidesRef = useRef(htmlSlides);
  slidesRef.current = htmlSlides;

  useEffect(() => {
    if (!htmlSlides?.length) { setThumbs([]); return; }

    const slides = htmlSlides;
    let cancelled = false;
    setThumbs([]);

    const THUMB_W = 320;

    async function render() {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.left = "-9999px";
      iframe.style.width = "1920px";
      iframe.style.height = "1080px";
      iframe.style.border = "none";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);

      try {
        for (let i = 0; i < slides.length; i++) {
          if (cancelled || slidesRef.current !== slides) break;

          iframe.srcdoc = slides[i];
          await new Promise<void>((resolve) => { iframe.onload = () => resolve(); });
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

          try {
            const { default: html2canvas } = await import("html2canvas");
            const body = iframe.contentDocument?.body;
            if (!body) continue;

            const canvas = await html2canvas(body, {
              width: 1920,
              height: 1080,
              scale: THUMB_W / 1920,
              logging: false,
              useCORS: true,
              allowTaint: true,
              backgroundColor: "#ffffff",
            });

            if (cancelled || slidesRef.current !== slides) break;

            const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
            setThumbs((prev) => {
              const next = [...prev];
              next[i] = dataUrl;
              return next;
            });
          } catch {
            // skip failed thumbnail
          }

          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }
    }

    render();
    return () => { cancelled = true; };
  }, [htmlSlides]);

  return thumbs;
}
