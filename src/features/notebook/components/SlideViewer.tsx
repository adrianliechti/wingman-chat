import { Loader2, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getConfig } from "@/shared/config";
import { getTextFromContent } from "@/shared/types/chat";
import type { NotebookOutput, SlideFormat } from "../types/notebook";
import { PptxSlidePreview } from "./PptxSlidePreview";

interface SlideViewerProps {
  content: string;
  slides: string[];
  htmlSlides?: string[];
  pptxSlides?: string[];
  slideFormat?: SlideFormat;
  output: NotebookOutput;
  onRefine?: (updatedOutput: NotebookOutput) => void;
}

export function SlideViewer({ content, slides, htmlSlides, pptxSlides, slideFormat, output, onRefine }: SlideViewerProps) {
  const isPptxMode = slideFormat === "pptx" && pptxSlides && pptxSlides.length > 0;
  const isHtmlMode = !isPptxMode && htmlSlides && htmlSlides.length > 0;

  const [activeIndex, setActiveIndex] = useState(1);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const slideKeyCounts = new Map<string, number>();

  // Generate lightweight image thumbnails from HTML slides one-by-one
  const thumbnails = useSlideThumbnails(isHtmlMode ? htmlSlides : undefined);

  // Scale the 960x540 iframe to fit the container
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const [slideScale, setSlideScale] = useState(1);

  useEffect(() => {
    const el = slideContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const cw = entry.contentRect.width;
      const ch = entry.contentRect.height;
      // Fit 960x540 inside the container, maintaining aspect ratio
      const scaleX = cw / 1920;
      const scaleY = ch / 1080;
      setSlideScale(Math.min(scaleX, scaleY));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleRefineSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!refinePrompt.trim() || isRefining || activeIndex === 0) return;

    const slideIdx = activeIndex - 1;
    setIsRefining(true);
    setRefineError(null);

    try {
      const config = getConfig();
      const client = config.client;
      const model = config.notebook?.model || "";

      if (isPptxMode) {
        // Refine PPTX slide XML
        const currentXml = pptxSlides![slideIdx];
        const result = await client.complete(
          model,
          `You are refining a single PPTX slide. The slide is raw Office Open XML. Apply the user's refinement request. Return ONLY the complete updated <p:sld> XML document. Keep all namespace declarations. Coordinates are in EMU (914400 = 1 inch). Slide is 9144000 x 5143500 EMU.`,
          [
            { role: "user", content: [{ type: "text", text: `Current slide XML:\n\n\`\`\`xml\n${currentXml}\n\`\`\`\n\nRefinement request: ${refinePrompt.trim()}` }] },
          ],
          [],
        );

        const raw = getTextFromContent(result.content);
        if (raw?.trim()) {
          const cleaned = raw
            .replace(/^```xml?\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();
          // Find the XML start
          const xmlStart = cleaned.indexOf("<?xml") !== -1 ? cleaned.indexOf("<?xml") : cleaned.indexOf("<p:sld");
          const updatedXml = xmlStart >= 0 ? cleaned.slice(xmlStart) : cleaned;
          const updatedPptxSlides = [...pptxSlides!];
          updatedPptxSlides[slideIdx] = updatedXml;
          onRefine?.({ ...output, pptxSlides: updatedPptxSlides });
        }
      } else if (isHtmlMode) {
        // Refine HTML slide
        const currentHtml = htmlSlides![slideIdx];
        const result = await client.complete(
          model,
          `You are refining a single HTML slide. The slide is a self-contained HTML document (1920x1080px, 16:9). Apply the user's refinement request. Return ONLY the complete updated HTML document.`,
          [
            { role: "user", content: [{ type: "text", text: `Current slide HTML:\n\n${currentHtml}\n\nRefinement request: ${refinePrompt.trim()}` }] },
          ],
          [],
        );

        const newHtml = getTextFromContent(result.content);
        if (newHtml?.trim()) {
          const cleaned = newHtml
            .replace(/^```html?\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();
          const updatedHtmlSlides = [...htmlSlides!];
          updatedHtmlSlides[slideIdx] = cleaned;
          onRefine?.({ ...output, htmlSlides: updatedHtmlSlides });
        }
      } else {
        // Refine image slide
        const rendererModel = config.renderer?.model || "";
        const slideTexts = content.split(/\n\n---\n\n/);
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
          const updatedSlides = [...slides];
          updatedSlides[slideIdx] = imageUrl;
          onRefine?.({ ...output, slides: updatedSlides });
        }
      }

      setRefinePrompt("");
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Main view */}
      <div className="flex-1 overflow-y-auto min-h-0 relative">
        {isPptxMode ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="rounded-lg shadow-lg overflow-hidden">
              <PptxSlidePreview xml={pptxSlides![activeIndex - 1]} />
            </div>
          </div>
        ) : isHtmlMode ? (
          <div className="h-full flex items-center justify-center p-6" ref={slideContainerRef}>
            <div
              className="rounded-lg shadow-lg overflow-hidden bg-white"
              style={{
                width: 1920 * slideScale,
                height: 1080 * slideScale,
              }}
            >
              <iframe
                srcDoc={htmlSlides![activeIndex - 1]}
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
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <img
              src={slides[activeIndex - 1]}
              alt={`Slide ${activeIndex}`}
              className="max-w-full max-h-full rounded-lg shadow-lg"
            />
          </div>
        )}

        {/* Floating refine prompt */}
        {activeIndex > 0 && (
          <div className="absolute bottom-4 left-4 right-4 z-20">
            <form onSubmit={handleRefineSubmit}>
              <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-neutral-700/40 shadow-lg shadow-black/5 dark:shadow-black/20 p-3">
                <input
                  type="text"
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  placeholder="Refine this slide..."
                  disabled={isRefining}
                  className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none disabled:text-neutral-400"
                />
                <button
                  type="submit"
                  disabled={!refinePrompt.trim() || isRefining}
                  className="p-2 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 disabled:text-neutral-300 dark:disabled:text-neutral-600 rounded-xl hover:bg-white/40 dark:hover:bg-neutral-800/40 transition-all"
                  title="Refine slide"
                >
                  {isRefining ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <SparklesIcon size={16} />
                  )}
                </button>
              </div>

              {refineError && (
                <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50/90 dark:bg-red-950/40 backdrop-blur-xl px-3 py-2 rounded-xl border border-red-200/40 dark:border-red-800/40">
                  {refineError}
                </div>
              )}
            </form>
          </div>
        )}
      </div>

      {/* Bottom thumbnail navigation */}
      <div className="shrink-0 overflow-x-auto px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Slide thumbnails */}
          {isPptxMode
            ? pptxSlides!.map((_, i) => (
                <button
                  key={`pptx-slide-${i}`}
                  type="button"
                  onClick={() => setActiveIndex(i + 1)}
                  className={`shrink-0 w-20 aspect-[16/9] rounded-lg border-2 overflow-hidden transition-colors flex items-center justify-center text-[9px] font-medium text-neutral-500 ${
                    activeIndex === i + 1
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                      : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-neutral-50 dark:bg-neutral-800/50"
                  }`}
                >
                  {i + 1}
                </button>
              ))
            : isHtmlMode
              ? htmlSlides!.map((_, i) => (
                  <button
                    key={`html-slide-${i}`}
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
                ))
              : slides.map((slideUrl, i) => {
                  const occurrence = (slideKeyCounts.get(slideUrl) ?? 0) + 1;
                  slideKeyCounts.set(slideUrl, occurrence);

                  return (
                    <button
                      key={`${slideUrl}:${occurrence}`}
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
                  );
                })}
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

          // Yield to main thread between slides
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
