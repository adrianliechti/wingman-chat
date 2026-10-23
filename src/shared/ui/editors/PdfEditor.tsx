import { memo, useEffect, useRef, useState } from "react";
import { withAbort } from "@/shared/lib/abortSignals";
import { dataUrlToBytes } from "@/shared/lib/fileContent";
import { renderPdfPage, withPdfDocument } from "@/shared/lib/pdf";

interface PdfEditorProps {
  content: string;
}

/** Lazily renders each page as it nears the viewport until `lifetime` aborts. */
async function renderPdfPages(
  container: HTMLElement,
  content: string,
  lifetime: AbortController,
  onError: (message: string) => void,
) {
  const { signal } = lifetime;
  const bytes = dataUrlToBytes(content)?.bytes;
  if (!bytes) throw new Error("Invalid PDF data");
  await withPdfDocument(bytes, signal, async (pdf) => {
    const first = await withAbort(signal, () => pdf.getPage(1));
    const initial = first.getViewport({ scale: 1 });
    first.cleanup();
    const slots = new Map<Element, { number: number; canvas?: HTMLCanvasElement; rendering?: AbortController }>();
    const visible = new Set<Element>();
    let busy = false;
    const release = (element: Element) => {
      const slot = slots.get(element)!;
      slot.rendering?.abort();
      if (slot.canvas) {
        slot.canvas.width = slot.canvas.height = 0;
        slot.canvas.remove();
        slot.canvas = undefined;
      }
    };
    // A single render is active; only nearby pages retain canvas backing stores.
    const renderVisible = async () => {
      if (busy) return;
      busy = true;
      try {
        while (!signal.aborted) {
          const element = [...visible].find((element) => !slots.get(element)?.canvas);
          if (!element) break;
          const slot = slots.get(element)!;
          const rendering = new AbortController();
          slot.rendering = rendering;
          const renderSignal = AbortSignal.any([signal, rendering.signal]);
          const canvas = document.createElement("canvas");
          slot.canvas = canvas;
          canvas.style.width = "100%";
          canvas.style.display = "block";
          canvas.setAttribute("aria-label", `Page ${slot.number}`);
          element.appendChild(canvas);
          try {
            const page = await withAbort(renderSignal, () => pdf.getPage(slot.number));
            try {
              const viewport = page.getViewport({ scale: 1 });
              (element as HTMLElement).style.aspectRatio = `${viewport.width} / ${viewport.height}`;
              await renderPdfPage(page, canvas, window.devicePixelRatio >= 2 ? 1.5 : 1.2, renderSignal);
            } finally {
              page.cleanup();
            }
          } catch (cause) {
            if (!renderSignal.aborted) throw cause;
          } finally {
            if (slot.rendering === rendering) slot.rendering = undefined;
          }
        }
      } catch (cause) {
        if (!signal.aborted) {
          onError(cause instanceof Error ? cause.message : "Failed to render PDF");
          lifetime.abort();
        }
      } finally {
        busy = false;
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else {
            visible.delete(entry.target);
            release(entry.target);
          }
        }
        void renderVisible();
      },
      { root: container.parentElement, rootMargin: "400px" },
    );
    try {
      for (let number = 1; number <= pdf.numPages; number++) {
        const element = document.createElement("div");
        element.style.aspectRatio = `${initial.width} / ${initial.height}`;
        element.style.marginBottom = "8px";
        element.style.background = "white";
        element.style.boxShadow = "0 1px 4px rgba(0,0,0,0.12)";
        slots.set(element, { number });
        container.appendChild(element);
        observer.observe(element);
      }
      await withAbort(signal, () => new Promise<void>(() => {}));
    } finally {
      observer.disconnect();
      for (const element of slots.keys()) release(element);
    }
  });
}

export const PdfEditor = memo(function PdfEditor({ content }: PdfEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!content || !container) return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    setError(null);

    void renderPdfPages(container, content, lifetime, setError).catch((cause: unknown) => {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Failed to render PDF");
    });

    return () => {
      lifetime.abort();
      container.replaceChildren();
    };
  }, [content]);

  return (
    <div className="h-full overflow-auto">
      {error && <div className="text-center text-sm text-red-500 p-8">{error}</div>}
      <div ref={containerRef} className="max-w-3xl mx-auto px-4 pt-1 pb-4" hidden={!!error} />
    </div>
  );
});
