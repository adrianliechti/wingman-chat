/**
 * Shared output-download dispatcher.
 *
 * One source of truth for "what happens when the user clicks Download on
 * any notebook output" — used by both the StudioPanel action menu and the
 * preview's Download icon. The hook returns:
 *   - `trigger(output)` — start a download (opens a modal or saves directly)
 *   - `canDownload(output)` — boolean check for showing the trigger
 *   - `modals` — the JSX to mount once at the page level
 *
 * Dispatch logic:
 *   - HTML slides → multi-step PDF/PPTX/PNG overlay (the existing slide one)
 *   - Podcast / infographic / image-slides / report → direct download
 */

import { AlertCircle, FileImage, FileText, Loader2, Presentation, X } from "lucide-react";
import { useState } from "react";
import { downloadFromUrl } from "@/shared/lib/utils";
import type { NotebookOutput } from "../types/notebook";

type SlideFormat = "pdf" | "pptx-image" | "pptx-hybrid" | "png";

export function canDownload(output: NotebookOutput): boolean {
  if (output.type === "podcast" && output.audioUrl) return true;
  if (output.type === "infographic" && output.imageUrl) return true;
  if (output.type === "slides" && output.slides?.length) return true;
  if (output.type === "report" && output.content) return true;
  return false;
}

export function useOutputDownload() {
  // Slide multi-step overlay (HTML slides only).
  const [slideOverlay, setSlideOverlay] = useState<NotebookOutput | null>(null);
  const [slideExporting, setSlideExporting] = useState(false);
  const [slideError, setSlideError] = useState<string | null>(null);
  const [slideProgress, setSlideProgress] = useState<string | null>(null);

  const trigger = async (output: NotebookOutput): Promise<void> => {
    // HTML slides — multi-step export overlay.
    if (output.type === "slides" && output.slideContentType === "text/html" && output.slides?.length) {
      setSlideOverlay(output);
      setSlideError(null);
      return;
    }

    // Single-format outputs — direct download. Callers invoke trigger from
    // onClick without awaiting, so never let a rejection escape unhandled.
    try {
      const slug = output.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "output";
      if (output.type === "podcast" && output.audioUrl) {
        downloadFromUrl(output.audioUrl, `${slug}.wav`);
      } else if (output.type === "infographic" && output.imageUrl) {
        downloadFromUrl(output.imageUrl, `${slug}.png`);
      } else if (output.type === "slides" && output.slides?.length) {
        const { jsPDF } = await import("jspdf");
        const firstImg = await loadImage(output.slides[0]);
        const w = firstImg.naturalWidth;
        const h = firstImg.naturalHeight;
        const landscape = w > h;
        const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "px", format: [w, h] });
        doc.addImage(output.slides[0], "PNG", 0, 0, w, h);
        for (let i = 1; i < output.slides.length; i++) {
          doc.addPage([w, h], landscape ? "landscape" : "portrait");
          doc.addImage(output.slides[i], "PNG", 0, 0, w, h);
        }
        doc.save(`${slug}.pdf`);
      } else if (output.type === "report" && output.content) {
        await renderReportPdf(output.content, slug);
      }
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  const runSlideExport = async (format: SlideFormat) => {
    if (!slideOverlay?.slides?.length) return;
    const slides = slideOverlay.slides;
    const slug = slideOverlay.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    setSlideExporting(true);
    setSlideError(null);
    setSlideProgress(null);
    try {
      if (format === "pdf") {
        const { downloadHtmlSlidesAsPdf } = await import("../lib/html-slide-export");
        await downloadHtmlSlidesAsPdf(slides, slug);
      } else if (format === "pptx-image") {
        const { downloadHtmlSlidesAsPptx } = await import("../lib/html-slide-export");
        await downloadHtmlSlidesAsPptx(slides, slug);
      } else if (format === "pptx-hybrid") {
        setSlideProgress("Exporting slides...");
        const { downloadHtmlSlidesAsHybridPptx } = await import("../lib/pptx-export-hybrid");
        await downloadHtmlSlidesAsHybridPptx(slides, slug, (current, total) => {
          setSlideProgress(`Exporting slide ${current} of ${total}...`);
        });
      } else if (format === "png") {
        const { downloadHtmlSlidesAsPng } = await import("../lib/html-slide-export");
        await downloadHtmlSlidesAsPng(slides, slug);
      }
      setSlideOverlay(null);
    } catch (err) {
      setSlideError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setSlideExporting(false);
      setSlideProgress(null);
    }
  };

  const modals = (
    <>
      {/* Slide export overlay (HTML slides — multi-format PDF/PPTX/PNG). */}
      {slideOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-80 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Export Slides</h3>
              {!slideExporting && (
                <button
                  type="button"
                  onClick={() => {
                    setSlideOverlay(null);
                    setSlideError(null);
                  }}
                  className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <X size={14} className="text-neutral-400" />
                </button>
              )}
            </div>
            <div className="p-3">
              {slideExporting ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8">
                  <Loader2 size={24} className="animate-spin text-neutral-400" />
                  <span className="text-xs text-neutral-500">{slideProgress || "Exporting..."}</span>
                </div>
              ) : slideError ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 rounded-lg">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>{slideError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSlideError(null)}
                    className="w-full text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 py-1.5"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <SlideExportRow
                    icon={FileText}
                    title="PDF"
                    subtitle="Best for viewing and sharing"
                    onClick={() => runSlideExport("pdf")}
                  />
                  <SlideExportRow
                    icon={FileImage}
                    title="PNG Images"
                    subtitle="One image per slide, in a ZIP"
                    onClick={() => runSlideExport("png")}
                  />
                  <SlideExportRow
                    icon={Presentation}
                    title="PowerPoint (Fixed)"
                    subtitle="Slides as images, not editable"
                    onClick={() => runSlideExport("pptx-image")}
                  />
                  <SlideExportRow
                    icon={Presentation}
                    title="PowerPoint (Editable)"
                    subtitle="Editable text, approximate layout"
                    onClick={() => runSlideExport("pptx-hybrid")}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );

  return { trigger, canDownload, modals };
}

// ── Helpers ───────────────────────────────────────────────────────────

function SlideExportRow({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: typeof FileText;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors text-left"
    >
      <Icon size={16} className="text-neutral-400 shrink-0" />
      <div>
        <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
        <p className="text-xs text-neutral-400">{subtitle}</p>
      </div>
    </button>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderReportPdf(html: string, slug: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.width = "800px";
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
    });
    const { jsPDF } = await import("jspdf");
    const html2canvas = (await import("html2canvas")).default;
    const body = iframe.contentDocument?.body;
    if (!body) return;
    const canvas = await html2canvas(body, { scale: 2, useCORS: true, logging: false, windowWidth: 800 });
    const imgData = canvas.toDataURL("image/jpeg", 0.85);
    const pxW = canvas.width;
    const pxH = canvas.height;
    const pdfW = 595;
    const pdfH = (pxH / pxW) * pdfW;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: [pdfW, pdfH] });
    doc.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);
    doc.save(`${slug}.pdf`);
  } finally {
    iframe.remove();
  }
}
