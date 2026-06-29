import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { pptxToHtml } from "@/shared/lib/pptxToHtml";
import { OfficeMarkdownEditor } from "./OfficeMarkdownEditor";
import { OFFICE_IFRAME_SANDBOX, useOfficeConversion } from "./useOfficeConversion";

interface PptxEditorProps {
  path: string;
  content: string;
  contentType?: string;
}

/**
 * High-fidelity PPTX preview: converts the deck to per-slide HTML documents
 * (see `pptxToHtml`) and renders them like the notebook slide viewer — a
 * thumbnail strip on top and the active slide scaled to fit below.
 *
 * Falls back to the extracted-markdown preview if conversion fails.
 */
export const PptxEditor = memo(function PptxEditor({ path, content, contentType }: PptxEditorProps) {
  const { result, failed } = useOfficeConversion(path, content, contentType, pptxToHtml);
  const [activeIndex, setActiveIndex] = useState(1);

  // New deck → back to the first slide
  useEffect(() => {
    setActiveIndex(1);
  }, [result]);

  // Scale the active slide to fit its container
  const [slideContainer, setSlideContainer] = useState<HTMLDivElement | null>(null);
  const [slideScale, setSlideScale] = useState(1);
  const slideW = result?.width ?? 1280;
  const slideH = result?.height ?? 720;

  useEffect(() => {
    if (!slideContainer) return;
    const observer = new ResizeObserver(([entry]) => {
      const cw = entry.contentRect.width;
      const ch = entry.contentRect.height;
      setSlideScale(Math.min(cw / slideW, ch / slideH));
    });
    observer.observe(slideContainer);
    return () => observer.disconnect();
  }, [slideContainer, slideW, slideH]);

  const thumbnails = useSlideThumbnails(result?.slides, slideW, slideH);

  // Keep the active thumbnail in view while navigating
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const el = thumbRefs.current[activeIndex - 1];
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  if (failed) {
    return <OfficeMarkdownEditor path={path} content={content} contentType={contentType} />;
  }

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-sm text-neutral-400 dark:text-neutral-500 p-8">
        <Loader2 size={16} className="animate-spin" />
        Rendering slides…
      </div>
    );
  }

  const slideCount = result.slides.length;
  const currentSlideHtml = result.slides[activeIndex - 1];

  return (
    <div className="h-full flex flex-col bg-neutral-50 dark:bg-neutral-900/60">
      {/* Thumbnail strip */}
      <div className="shrink-0 overflow-x-auto px-3 py-2">
        <div className="flex items-center gap-2">
          {result.slides.map((_, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: slides are static once converted
              key={i}
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              type="button"
              onClick={() => setActiveIndex(i + 1)}
              className={`shrink-0 w-32 rounded-lg border-2 overflow-hidden transition-colors bg-white dark:bg-neutral-800 ${
                activeIndex === i + 1
                  ? "border-blue-500"
                  : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
              }`}
              style={{ aspectRatio: `${slideW} / ${slideH}` }}
            >
              {thumbnails[i] ? (
                <img src={thumbnails[i]} alt={`Slide ${i + 1}`} className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-medium text-neutral-400 flex items-center justify-center h-full">
                  {i + 1}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main slide view */}
      <div className="flex-1 overflow-hidden min-h-0 relative">
        <div className="h-full flex items-center justify-center px-3 pt-2 pb-8" ref={setSlideContainer}>
          <div
            className="rounded-lg shadow-lg overflow-hidden bg-white"
            style={{ width: slideW * slideScale, height: slideH * slideScale }}
          >
            <iframe
              srcDoc={currentSlideHtml}
              style={{
                width: slideW,
                height: slideH,
                border: "none",
                transform: `scale(${slideScale})`,
                transformOrigin: "top left",
              }}
              sandbox={OFFICE_IFRAME_SANDBOX}
              title={`Slide ${activeIndex}`}
            />
          </div>
        </div>

        {/* Prev / next navigation */}
        {slideCount > 1 && (
          <div className="absolute inset-0 px-2 pt-2 pb-8 flex items-center justify-between pointer-events-none z-10">
            <div>
              {activeIndex > 1 && (
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => Math.max(1, i - 1))}
                  className="pointer-events-auto p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/60 transition-colors"
                  title="Previous slide"
                  aria-label="Previous slide"
                >
                  <ChevronLeft size={18} />
                </button>
              )}
            </div>
            <div>
              {activeIndex < slideCount && (
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => Math.min(slideCount, i + 1))}
                  className="pointer-events-auto p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/60 transition-colors"
                  title="Next slide"
                  aria-label="Next slide"
                >
                  <ChevronRight size={18} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Slide counter */}
        <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
          <span className="text-xs text-neutral-400 dark:text-neutral-500 tabular-nums">
            {activeIndex} / {slideCount}
          </span>
        </div>
      </div>
    </div>
  );
});

/**
 * Render HTML slides to small image data URLs one-by-one using a single
 * off-screen iframe + canvas — same approach as the notebook slide viewer,
 * but parameterized by the deck's slide dimensions.
 */
function useSlideThumbnails(htmlSlides: string[] | undefined, slideW: number, slideH: number): string[] {
  const [thumbs, setThumbs] = useState<string[]>([]);

  useEffect(() => {
    if (!htmlSlides?.length) {
      setThumbs([]);
      return;
    }

    const slides = htmlSlides;
    let cancelled = false;
    setThumbs([]);

    const THUMB_W = 256;

    async function render() {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.left = "-9999px";
      iframe.style.width = `${slideW}px`;
      iframe.style.height = `${slideH}px`;
      iframe.style.border = "none";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);

      try {
        for (let i = 0; i < slides.length; i++) {
          if (cancelled) break;

          iframe.srcdoc = slides[i];
          // Guard with a timeout — a srcdoc swap that never fires load would
          // otherwise stall the loop and leave the remaining thumbnails blank.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1500);
            iframe.onload = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          // Give the slide's inline autofit script a beat to re-run after
          // fonts load, so thumbnails capture the fitted text.
          await new Promise<void>((resolve) => setTimeout(resolve, 80));

          try {
            const { default: html2canvas } = await import("html2canvas");
            const body = iframe.contentDocument?.body;
            if (!body) continue;

            const canvas = await html2canvas(body, {
              width: slideW,
              height: slideH,
              scale: THUMB_W / slideW,
              logging: false,
              useCORS: true,
              allowTaint: true,
              backgroundColor: "#ffffff",
            });

            if (cancelled) break;

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
    return () => {
      cancelled = true;
    };
  }, [htmlSlides, slideW, slideH]);

  return thumbs;
}
