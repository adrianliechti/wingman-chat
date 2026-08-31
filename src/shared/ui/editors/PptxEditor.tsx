import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { type PptxHtmlResult, pptxToHtml } from "@/shared/lib/pptxToHtml";
import { OfficeZoomControls } from "./OfficeZoomControls";
import { OfficeMarkdownEditor } from "./OfficeMarkdownEditor";
import { OFFICE_IFRAME_SANDBOX, useOfficeConversion } from "./useOfficeConversion";

interface PptxEditorProps {
  path: string;
  content: string;
  contentType?: string;
}

interface SlideHtmlState {
  presentation: PptxHtmlResult | null;
  index: number;
  html: string | null;
  failed: boolean;
}

function useSlideHtml(presentation: PptxHtmlResult | null, index: number): SlideHtmlState {
  const [state, setState] = useState<SlideHtmlState>({ presentation: null, index: -1, html: null, failed: false });
  useEffect(() => {
    let cancelled = false;
    if (!presentation) return;
    presentation.getSlide(index).then(
      (html) => {
        if (!cancelled) setState({ presentation, index, html, failed: false });
      },
      () => {
        if (!cancelled) setState({ presentation, index, html: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [index, presentation]);
  return state.presentation === presentation && state.index === index
    ? state
    : { presentation, index, html: null, failed: false };
}

/**
 * Progressive PPTX preview: slide HTML and thumbnail iframes are materialized
 * only for the active/visible virtual window. No all-deck html2canvas pass runs.
 */
export const PptxEditor = memo(function PptxEditor({ path, content, contentType }: PptxEditorProps) {
  const { result, failed } = useOfficeConversion(path, content, contentType, pptxToHtml);
  const [viewState, setViewState] = useState<{
    presentation: PptxHtmlResult | null;
    activeIndex: number;
    zoom: number;
  }>({ presentation: null, activeIndex: 0, zoom: 1 });
  const view = viewState.presentation === result ? viewState : { presentation: result, activeIndex: 0, zoom: 1 };
  const { activeIndex, zoom } = view;

  const currentIndex = result ? Math.max(0, Math.min(result.slideCount - 1, activeIndex)) : 0;
  const { html: currentSlideHtml, failed: slideFailed } = useSlideHtml(result, currentIndex);
  const [slideContainer, setSlideContainer] = useState<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const slideWidth = result?.width ?? 1280;
  const slideHeight = result?.height ?? 720;

  useEffect(() => {
    if (!slideContainer) return;
    const observer = new ResizeObserver(([entry]) => {
      const availableWidth = Math.max(1, entry.contentRect.width - 24);
      const availableHeight = Math.max(1, entry.contentRect.height - 24);
      setFitScale(Math.min(availableWidth / slideWidth, availableHeight / slideHeight));
    });
    observer.observe(slideContainer);
    return () => observer.disconnect();
  }, [slideContainer, slideHeight, slideWidth]);

  if (failed) {
    return <OfficeMarkdownEditor path={path} content={content} contentType={contentType} />;
  }
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-sm text-neutral-400 dark:text-neutral-500 p-8">
        <Loader2 size={16} className="animate-spin" />
        Opening presentation…
      </div>
    );
  }

  const scale = fitScale * zoom;
  const slideCount = result.slideCount;
  const selectSlide = (index: number) => {
    const next = Math.max(0, Math.min(slideCount - 1, index));
    setViewState({ ...view, activeIndex: next });
  };

  return (
    <div
      className="h-full min-h-0 flex flex-col bg-neutral-50 dark:bg-neutral-900/60 outline-none"
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.target as Element).closest("a,button,input,select,textarea")) return;
        if (event.key === "ArrowLeft" || event.key === "PageUp") selectSlide(currentIndex - 1);
        else if (event.key === "ArrowRight" || event.key === "PageDown") selectSlide(currentIndex + 1);
        else return;
        event.preventDefault();
      }}
    >
      <SlideStrip presentation={result} activeIndex={currentIndex} onSelect={selectSlide} />

      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div ref={setSlideContainer} className="h-full overflow-auto">
          <div className="min-w-full min-h-full grid place-items-center p-3">
            <div
              className="rounded-lg shadow-lg overflow-hidden bg-white shrink-0"
              style={{ width: slideWidth * scale, height: slideHeight * scale }}
            >
              {currentSlideHtml ? (
                <iframe
                  key={currentIndex}
                  srcDoc={currentSlideHtml}
                  style={{
                    width: slideWidth,
                    height: slideHeight,
                    border: "none",
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                  }}
                  sandbox={OFFICE_IFRAME_SANDBOX}
                  title={`Slide ${currentIndex + 1}`}
                />
              ) : slideFailed ? (
                <div className="h-full grid place-items-center px-6 text-center text-sm text-neutral-500">
                  This slide could not be rendered. You can still open another slide.
                </div>
              ) : (
                <div className="h-full grid place-items-center text-sm text-neutral-400">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              )}
            </div>
          </div>
        </div>

        {slideCount > 1 && (
          <div className="absolute inset-y-0 left-0 right-0 px-2 flex items-center justify-between pointer-events-none z-10">
            <button
              type="button"
              onClick={() => selectSlide(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="pointer-events-auto p-1.5 rounded-full text-neutral-500 bg-white/70 dark:bg-neutral-800/70 shadow-sm disabled:opacity-0"
              aria-label="Previous slide"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => selectSlide(currentIndex + 1)}
              disabled={currentIndex === slideCount - 1}
              className="pointer-events-auto p-1.5 rounded-full text-neutral-500 bg-white/70 dark:bg-neutral-800/70 shadow-sm disabled:opacity-0"
              aria-label="Next slide"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center border-t border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="px-3 text-[11px] tabular-nums">
          Slide {currentIndex + 1} of {slideCount}
        </span>
        <OfficeZoomControls
          value={zoom}
          onChange={(value) => setViewState({ ...view, zoom: value })}
          className="ml-auto border-l border-neutral-200 dark:border-neutral-800"
        />
      </div>
    </div>
  );
});

function SlideStrip({
  presentation,
  activeIndex,
  onSelect,
}: {
  presentation: PptxHtmlResult;
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbnailWidth = 128;
  const thumbnailHeight = Math.min(108, (thumbnailWidth * presentation.height) / presentation.width);
  const itemWidth = thumbnailWidth + 10;
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: presentation.slideCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => itemWidth,
    overscan: 2,
  });

  useEffect(() => {
    virtualizer.scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex, virtualizer]);

  return (
    <div ref={scrollRef} className="shrink-0 overflow-x-auto px-3 py-2" style={{ height: thumbnailHeight + 18 }}>
      <div className="relative" style={{ width: virtualizer.getTotalSize(), height: thumbnailHeight }}>
        {virtualizer.getVirtualItems().map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.index)}
            className={`absolute top-0 rounded-md border-2 overflow-hidden bg-white dark:bg-neutral-800 transition-colors ${
              activeIndex === item.index
                ? "border-blue-500"
                : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-400"
            }`}
            style={{
              left: item.start,
              width: thumbnailWidth,
              height: thumbnailHeight,
            }}
            aria-label={`Show slide ${item.index + 1}`}
          >
            <LazySlideThumbnail
              presentation={presentation}
              index={item.index}
              width={thumbnailWidth}
              height={thumbnailHeight}
            />
            <span className="absolute left-1 bottom-0.5 rounded bg-black/55 px-1 text-[9px] leading-4 text-white">
              {item.index + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LazySlideThumbnail({
  presentation,
  index,
  width,
  height,
}: {
  presentation: PptxHtmlResult;
  index: number;
  width: number;
  height: number;
}) {
  const { html, failed } = useSlideHtml(presentation, index);
  if (!html || failed) {
    return (
      <span className="h-full flex items-center justify-center text-xs text-neutral-400">
        {failed ? index + 1 : <Loader2 size={12} className="animate-spin" />}
      </span>
    );
  }
  const scale = Math.min(width / presentation.width, height / presentation.height);
  const renderedWidth = presentation.width * scale;
  const renderedHeight = presentation.height * scale;
  return (
    <iframe
      srcDoc={html}
      sandbox={OFFICE_IFRAME_SANDBOX}
      tabIndex={-1}
      aria-hidden="true"
      title={`Slide ${index + 1} thumbnail`}
      style={{
        position: "absolute",
        left: (width - renderedWidth) / 2,
        top: (height - renderedHeight) / 2,
        width: presentation.width,
        height: presentation.height,
        border: 0,
        pointerEvents: "none",
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
    />
  );
}
