import {
  AlertCircle,
  AudioLines,
  BarChart3,
  CircleHelp,
  Download,
  FileImage,
  FileText,
  Loader2,
  Network,
  Presentation,
  StickyNote,
  Table2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { downloadFromUrl } from "@/shared/lib/utils";
import type { File } from "@/shared/types/file";
import type { BuildInstructionsOptions } from "../lib/styles";
import type { NotebookOutput, OutputType } from "../types/notebook";
import { type GeneratorOptions, OutputGeneratorDialog } from "./OutputGeneratorDialog";

interface StudioPanelProps {
  sources: File[];
  outputs: NotebookOutput[];
  onGenerate: (type: OutputType, styleId?: string, options?: BuildInstructionsOptions) => void;
  onDeleteOutput: (outputId: string) => void;
  onSelectOutput: (output: NotebookOutput) => void;
}

const OUTPUT_TYPES: {
  type: OutputType;
  label: string;
  icon: typeof AudioLines;
}[] = [
  { type: "podcast", label: "Podcast", icon: AudioLines },
  { type: "slides", label: "Slides", icon: Presentation },
  { type: "report", label: "Report", icon: Table2 },
  { type: "infographic", label: "Infographic", icon: BarChart3 },
  { type: "quiz", label: "Quiz", icon: CircleHelp },
  { type: "mindmap", label: "Mind Map", icon: Network },
];

type ExportFormat = "pdf" | "pptx-image" | "pptx-hybrid" | "pptx-editable" | "png";

export function StudioPanel({ sources, outputs, onGenerate, onDeleteOutput, onSelectOutput }: StudioPanelProps) {
  const hasSources = sources.length > 0;
  const [dialogType, setDialogType] = useState<OutputType | null>(null);
  const [exportOverlay, setExportOverlay] = useState<NotebookOutput | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  // Keep the type stable during the exit animation.
  const stableDialogType = useRef<OutputType>("slides");
  if (dialogType) stableDialogType.current = dialogType;

  const downloadOutput = async (output: NotebookOutput) => {
    // For HTML slides, show export overlay instead of direct download
    if (output.type === "slides" && output.slideContentType === "text/html" && output.slides?.length) {
      setExportOverlay(output);
      setExportError(null);
      return;
    }

    const slug = output.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    if (output.type === "podcast" && output.audioUrl) {
      downloadDataUrl(output.audioUrl, `${slug}.wav`);
    } else if (output.type === "infographic" && output.imageUrl) {
      downloadDataUrl(output.imageUrl, `${slug}.png`);
    } else if (output.type === "slides" && output.slides?.length) {
      await downloadSlidesAsPdf(output.slides, slug);
    } else if (output.type === "report" && output.content) {
      await downloadReportAsPdf(output.content, slug);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (!exportOverlay?.slides?.length) return;
    const slides = exportOverlay.slides;
    const slug = exportOverlay.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    setIsExporting(true);
    setExportError(null);
    setExportProgress(null);

    try {
      if (format === "pdf") {
        const { downloadHtmlSlidesAsPdf } = await import("../lib/html-slide-export");
        await downloadHtmlSlidesAsPdf(slides, slug);
      } else if (format === "pptx-image") {
        const { downloadHtmlSlidesAsPptx } = await import("../lib/html-slide-export");
        await downloadHtmlSlidesAsPptx(slides, slug);
      } else if (format === "pptx-hybrid") {
        setExportProgress("Exporting slides...");
        const { downloadHtmlSlidesAsHybridPptx } = await import("../lib/pptx-export-hybrid");
        await downloadHtmlSlidesAsHybridPptx(slides, slug, (current, total) => {
          setExportProgress(`Exporting slide ${current} of ${total}...`);
        });
      } else if (format === "png") {
        const { downloadHtmlSlidesAsPng } = await import("../lib/html-slide-export");
        await downloadHtmlSlidesAsPng(slides, slug);
      }
      setExportOverlay(null);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const DIALOG_TYPES = new Set<OutputType>(["slides", "podcast", "report", "infographic"]);

  const handleDialogGenerate = (_type: OutputType, { styleId, ...rest }: GeneratorOptions) => {
    onGenerate(_type, styleId, rest);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Output type buttons */}
      <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="grid grid-cols-2 gap-2">
          {OUTPUT_TYPES.map(({ type, label, icon: Icon }) => {
            if (DIALOG_TYPES.has(type)) {
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDialogType(type)}
                  disabled={!hasSources}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="text-xs font-medium">{label}</span>
                </button>
              );
            }
            return (
              <button
                key={type}
                type="button"
                onClick={() => onGenerate(type)}
                disabled={!hasSources}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left"
              >
                <Icon size={16} className="shrink-0" />
                <span className="text-xs font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Generated outputs list */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-3 min-h-0">
        {outputs.length > 0 && (
          <div className="space-y-1">
            {outputs.map((output) => {
              const typeInfo = OUTPUT_TYPES.find((t) => t.type === output.type);
              const Icon = typeInfo?.icon || StickyNote;
              const isGenerating = output.status === "generating";
              const isError = output.status === "error";

              return (
                <div
                  key={output.id}
                  className={`group/output flex items-center gap-2 py-1.5 transition-colors ${isGenerating ? "opacity-60" : isError ? "opacity-75" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (output.status !== "error") {
                        onSelectOutput(output);
                      }
                    }}
                    className={`flex flex-1 min-w-0 items-center gap-2 text-left ${
                      output.status === "error" ? "cursor-default" : "cursor-pointer"
                    }`}
                  >
                    <div className="w-6 h-6 rounded bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                      {isGenerating ? (
                        <Loader2 size={13} className="text-neutral-400 animate-spin" />
                      ) : isError ? (
                        <AlertCircle size={13} className="text-red-400" />
                      ) : (
                        <Icon size={13} className="text-neutral-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate">
                        {output.title}
                      </p>
                      <p className="text-[10px] text-neutral-400">
                        {isGenerating
                          ? "Generating..."
                          : isError
                            ? output.error || "Failed"
                            : new Date(output.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </button>
                  {!isGenerating && (
                    <div className="invisible group-hover/output:visible flex items-center shrink-0">
                      {output.status === "completed" && canDownload(output) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadOutput(output);
                          }}
                          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                          title="Download"
                        >
                          <Download size={12} className="text-neutral-400" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteOutput(output.id);
                        }}
                        className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                        title="Delete"
                      >
                        <X size={12} className="text-neutral-400" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Export format overlay */}
      {exportOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-80 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Export Slides</h3>
              {!isExporting && (
                <button
                  type="button"
                  onClick={() => {
                    setExportOverlay(null);
                    setExportError(null);
                  }}
                  className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <X size={14} className="text-neutral-400" />
                </button>
              )}
            </div>
            <div className="p-3">
              {isExporting ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8">
                  <Loader2 size={24} className="animate-spin text-neutral-400" />
                  <span className="text-xs text-neutral-500">{exportProgress || "Exporting..."}</span>
                </div>
              ) : exportError ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 rounded-lg">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>{exportError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExportError(null)}
                    className="w-full text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 py-1.5"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => handleExport("pdf")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors text-left"
                  >
                    <FileText size={16} className="text-neutral-400 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">PDF</p>
                      <p className="text-[10px] text-neutral-400">Image-based pages, best for sharing</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("png")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors text-left"
                  >
                    <FileImage size={16} className="text-neutral-400 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">PNG Images</p>
                      <p className="text-[10px] text-neutral-400">Individual slide images in a ZIP</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("pptx-image")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors text-left"
                  >
                    <Presentation size={16} className="text-neutral-400 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">PowerPoint (Image)</p>
                      <p className="text-[10px] text-neutral-400">Pixel-perfect, not editable</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("pptx-hybrid")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors text-left"
                  >
                    <Presentation size={16} className="text-neutral-400 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        PowerPoint (Editable)
                      </p>
                      <p className="text-[10px] text-neutral-400">Pixel-perfect design with editable text</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Output generator dialog */}
      <OutputGeneratorDialog
        open={dialogType !== null}
        type={stableDialogType.current}
        onClose={() => setDialogType(null)}
        onGenerate={handleDialogGenerate}
      />
    </div>
  );
}

function canDownload(output: NotebookOutput): boolean {
  return (
    (output.type === "podcast" && !!output.audioUrl) ||
    (output.type === "infographic" && !!output.imageUrl) ||
    (output.type === "slides" && !!output.slides?.length) ||
    (output.type === "report" && !!output.content)
  );
}

function downloadDataUrl(dataUrl: string, filename: string) {
  downloadFromUrl(dataUrl, filename);
}

async function downloadReportAsPdf(html: string, slug: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.width = "800px";
  iframe.srcdoc = html;

  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
  });

  const { jsPDF } = await import("jspdf");
  const html2canvas = (await import("html2canvas")).default;

  const body = iframe.contentDocument?.body;
  if (!body) {
    document.body.removeChild(iframe);
    return;
  }

  const canvas = await html2canvas(body, {
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: 800,
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.85);
  const pxW = canvas.width;
  const pxH = canvas.height;

  // A4-width in pt, scale height proportionally
  const pdfW = 595;
  const pdfH = (pxH / pxW) * pdfW;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: [pdfW, pdfH],
  });

  doc.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);
  doc.save(`${slug}.pdf`);

  document.body.removeChild(iframe);
}

async function downloadSlidesAsPdf(slides: string[], slug: string) {
  const { jsPDF } = await import("jspdf");

  // Load first image to get natural dimensions
  const firstImg = await loadImage(slides[0]);
  const w = firstImg.naturalWidth;
  const h = firstImg.naturalHeight;
  const landscape = w > h;

  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "px",
    format: [w, h],
  });

  doc.addImage(slides[0], "PNG", 0, 0, w, h);

  for (let i = 1; i < slides.length; i++) {
    doc.addPage([w, h], landscape ? "landscape" : "portrait");
    doc.addImage(slides[i], "PNG", 0, 0, w, h);
  }

  doc.save(`${slug}.pdf`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
