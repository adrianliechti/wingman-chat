/**
 * Main-thread Plotly renderer.
 *
 * plotly.js needs a real DOM, so figures produced inside the interpreter
 * worker are rendered here: the worker ships render manifests (and, once, the
 * plotly.js source from its bundled wheel) over RPC and writes the returned
 * image bytes back into its filesystem.
 */

import { decodeBase64 } from "@/shared/lib/utils";
import type { PlotlyRenderManifest, PlotlyRenderResult } from "./interpreterProtocol";

let plotlyJsLoaded = false;

async function ensurePlotlyJsLoaded(source?: string): Promise<void> {
  if (plotlyJsLoaded || (window as unknown as Record<string, unknown>).Plotly) {
    plotlyJsLoaded = true;
    return;
  }

  if (!source) {
    throw new Error("plotly.js source not available");
  }

  const blob = new Blob([source], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => {
      URL.revokeObjectURL(url);
      plotlyJsLoaded = true;
      resolve();
    };
    script.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load Plotly.js from bundled wheel"));
    };
    document.head.appendChild(script);
  });
}

function decodeDataUrl(dataUrl: string, format: string): Uint8Array | string {
  const commaIndex = dataUrl.indexOf(",");
  const header = dataUrl.substring(0, commaIndex);
  const payload = dataUrl.substring(commaIndex + 1);

  if (format === "svg") {
    return header.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
  }

  return decodeBase64(payload);
}

async function renderFigure(manifest: PlotlyRenderManifest): Promise<PlotlyRenderResult> {
  const Plotly = (window as unknown as Record<string, unknown>).Plotly as {
    newPlot: (el: HTMLElement, data: unknown[], layout?: unknown, config?: unknown) => Promise<void>;
    toImage: (el: HTMLElement, opts: Record<string, unknown>) => Promise<string>;
    purge: (el: HTMLElement) => void;
  };

  const div = document.createElement("div");
  div.style.position = "fixed";
  div.style.left = "-9999px";
  div.style.visibility = "hidden";
  document.body.appendChild(div);

  try {
    await Plotly.newPlot(div, manifest.fig.data, manifest.fig.layout || {}, manifest.fig.config || {});

    const opts: Record<string, unknown> = { format: manifest.format };
    if (manifest.width != null) opts.width = manifest.width;
    if (manifest.height != null) opts.height = manifest.height;
    if (manifest.scale != null) opts.scale = manifest.scale;

    const dataUrl = await Plotly.toImage(div, opts);
    Plotly.purge(div);

    return { path: manifest.file, data: decodeDataUrl(dataUrl, manifest.format) };
  } finally {
    div.remove();
  }
}

/**
 * Render a batch of figure manifests from the interpreter worker. Figures
 * that fail to render are logged and skipped, matching the previous
 * per-figure error behavior.
 */
export async function renderPlotlyFigures(
  manifests: PlotlyRenderManifest[],
  plotlyJs?: string,
): Promise<PlotlyRenderResult[]> {
  await ensurePlotlyJsLoaded(plotlyJs);

  const results: PlotlyRenderResult[] = [];
  for (const manifest of manifests) {
    try {
      results.push(await renderFigure(manifest));
    } catch (error) {
      console.error(`Failed to render plotly figure ${manifest.file}:`, error);
    }
  }
  return results;
}
