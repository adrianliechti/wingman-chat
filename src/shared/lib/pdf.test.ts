import { afterEach, describe, expect, it, vi } from "vitest";
import { pdfToMarkdown, rasterizePdf, renderPdfPage } from "./pdf";
import { getDocument } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function loading(promise: Promise<unknown>) {
  const task = { promise, destroy: vi.fn(async () => {}) };
  vi.mocked(getDocument).mockReturnValue(task as unknown as ReturnType<typeof getDocument>);
  return task;
}

describe("PDF worker ownership", () => {
  it("destroys a worker when opening malformed data fails", async () => {
    const task = loading(Promise.reject(new Error("Invalid PDF")));
    await expect(rasterizePdf(new Uint8Array([1]))).rejects.toThrow("Invalid PDF");
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("destroys the document after text extraction fails", async () => {
    const task = loading(
      Promise.resolve({
        numPages: 1,
        getPage: async () => {
          throw new Error("Bad page");
        },
      }),
    );
    await expect(pdfToMarkdown(new File(["pdf"], "test.pdf"))).rejects.toThrow("Bad page");
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("cancels a pending open without waiting for pdf.js to resolve it", async () => {
    const task = loading(new Promise(() => {}));
    const controller = new AbortController();
    const pending = rasterizePdf(new Uint8Array([1]), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("cancels a render and caps the canvas backing store", async () => {
    const cancel = vi.fn();
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 10000 * scale, height: 10000 * scale }),
      render: () => ({ promise: new Promise<void>(() => {}), cancel }),
    };
    const canvas = { width: 0, height: 0, getContext: () => ({}) };
    const controller = new AbortController();
    const pending = renderPdfPage(
      page as unknown as PDFPageProxy,
      canvas as unknown as HTMLCanvasElement,
      8,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(canvas.width * canvas.height).toBeLessThan(8_010_000);
  });
});
