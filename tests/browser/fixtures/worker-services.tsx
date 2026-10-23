import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import "../../../src/index.css";
import { PdfEditor } from "../../../src/shared/ui/editors/PdfEditor";
import { pdfToMarkdown, rasterizePdf } from "../../../src/shared/lib/pdf";
import { rasterizeSvg } from "../../../src/shared/lib/svg";
import { bytesToDataUrl } from "../../../src/shared/lib/fileContent";
import { createPreviewSession, type PreviewSession } from "../../../src/shared/lib/htmlPreviewSession";
import { emptyCapabilities } from "../../../src/shared/lib/artifactSdk/protocol";

const stats = { active: 0, created: 0 };
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  private counted: boolean;
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    this.counted = String(url).includes("pdf.worker");
    if (this.counted) {
      stats.active++;
      stats.created++;
    }
  }
  override terminate() {
    if (this.counted) {
      stats.active--;
      this.counted = false;
    }
    super.terminate();
  }
};
const root = createRoot(document.getElementById("root")!);
const sessions = new Map<string, { session: PreviewSession; iframe: HTMLIFrameElement }>();

function pdfBytes(count = 1) {
  const document = new jsPDF();
  for (let page = 1; page <= count; page++) {
    if (page > 1) document.addPage();
    document.text(`Page ${page}`, 20, 20);
  }
  return new Uint8Array(document.output("arraybuffer"));
}

const api = {
  stats: () => ({ ...stats }),
  showPdf(count = 1) {
    root.render(
      <StrictMode>
        <PdfEditor content={bytesToDataUrl(pdfBytes(count), "application/pdf")} />
      </StrictMode>,
    );
  },
  invalidPdf() {
    root.render(
      <StrictMode>
        <PdfEditor content={bytesToDataUrl(new Uint8Array([1, 2]), "application/pdf")} />
      </StrictMode>,
    );
  },
  closePdf: () => root.render(null),
  async extract() {
    return pdfToMarkdown(new File([pdfBytes(2)], "example.pdf"));
  },
  async rasterize() {
    return (await rasterizePdf(pdfBytes(), { pages: [1] })).map((page) => page.data.byteLength);
  },
  async cancelPdf() {
    const controller = new AbortController();
    const result = rasterizePdf(pdfBytes(), { signal: controller.signal });
    controller.abort();
    try {
      await result;
      return "completed";
    } catch {
      return "cancelled";
    }
  },
  async svg(mode: "render" | "cancel" | "oversized") {
    const controller = new AbortController();
    const pending = rasterizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
      {
        signal: controller.signal,
        width: mode === "oversized" ? 100_000 : 100,
        height: mode === "oversized" ? 100_000 : 100,
      },
    );
    if (mode === "cancel") controller.abort();
    try {
      return (await pending).byteLength;
    } catch (error) {
      return (error as Error).name + ": " + (error as Error).message;
    }
  },
  async preview(id: string) {
    const session = await createPreviewSession({ sdk: { source: "// fixture", capabilities: emptyCapabilities() } });
    await session.setFiles([
      { path: "/index.html", content: `<p id="out">${id}</p>`, contentType: "text/html" },
      { path: "/folder/page.html", content: `<p>child</p>`, contentType: "text/html" },
      { path: "/folder/data.txt", content: "data" },
    ]);
    const iframe = document.createElement("iframe");
    iframe.dataset.id = id;
    iframe.src = session.previewUrl("index.html");
    document.getElementById("previews")!.appendChild(iframe);
    sessions.set(id, { session, iframe });
    return session.token;
  },
  async closePreview(id: string) {
    const target = sessions.get(id)!;
    target.iframe.remove();
    await target.session.destroy();
    sessions.delete(id);
  },
  rename: (id: string) => sessions.get(id)!.session.renameFile("/folder", "/moved"),
  remove: (id: string) => sessions.get(id)!.session.deleteFile("/moved"),
};
window.workerServicesE2E = api;
declare global {
  interface Window {
    workerServicesE2E: typeof api;
  }
}
