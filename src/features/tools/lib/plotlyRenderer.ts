import type { PyodideInterface } from "pyodide";

const RENDER_QUEUE_DIR = "/tmp/__plotly_render_queue__";

interface RenderManifest {
  fig: { data: unknown[]; layout?: Record<string, unknown>; config?: Record<string, unknown> };
  file: string;
  format: string;
  width: number | null;
  height: number | null;
  scale: number | null;
}

let plotlyJsLoaded = false;

async function ensurePlotlyJsLoaded(pyodide: PyodideInterface): Promise<void> {
  if (plotlyJsLoaded || (window as unknown as Record<string, unknown>).Plotly) {
    plotlyJsLoaded = true;
    return;
  }

  // Discover plotly.min.js path from the installed wheel
  const plotlyJsPath = String(
    pyodide.runPython(
      "import plotly, os; os.path.join(os.path.dirname(plotly.__file__), 'package_data', 'plotly.min.js')",
    ),
  ).trim();

  const plotlyJsSource = pyodide.FS.readFile(plotlyJsPath, { encoding: "utf8" }) as string;

  // Inject into the page via a blob URL <script> tag
  const blob = new Blob([plotlyJsSource], { type: "application/javascript" });
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
    // SVG may come as URL-encoded or base64
    if (header.includes(";base64")) {
      return atob(payload);
    }
    return decodeURIComponent(payload);
  }

  // Binary formats (PNG, JPEG, WebP): always base64
  const binaryString = atob(payload);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function renderFigure(manifest: RenderManifest): Promise<{ path: string; data: Uint8Array | string }> {
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

    return {
      path: manifest.file,
      data: decodeDataUrl(dataUrl, manifest.format),
    };
  } finally {
    div.remove();
  }
}

function ensureDirectory(pyodide: PyodideInterface, dir: string): void {
  try {
    pyodide.FS.mkdirTree(dir);
  } catch {
    // Directory may already exist.
  }
}

export function clearRenderQueue(pyodide: PyodideInterface): void {
  try {
    const entries = (pyodide.FS.readdir(RENDER_QUEUE_DIR) as string[]).filter((e: string) => e !== "." && e !== "..");

    for (const entry of entries) {
      pyodide.FS.unlink(`${RENDER_QUEUE_DIR}/${entry}`);
    }
  } catch {
    // Queue directory may not exist yet.
  }
}

export async function processRenderQueue(pyodide: PyodideInterface): Promise<void> {
  let entries: string[];
  try {
    entries = (pyodide.FS.readdir(RENDER_QUEUE_DIR) as string[])
      .filter((e: string) => e !== "." && e !== ".." && e.endsWith(".json"))
      .sort();
  } catch {
    // No queue directory means no render requests.
    return;
  }

  if (entries.length === 0) {
    return;
  }

  await ensurePlotlyJsLoaded(pyodide);

  for (const entry of entries) {
    const manifestPath = `${RENDER_QUEUE_DIR}/${entry}`;
    try {
      const manifestJson = pyodide.FS.readFile(manifestPath, { encoding: "utf8" }) as string;
      const manifest = JSON.parse(manifestJson) as RenderManifest;

      const result = await renderFigure(manifest);

      // Ensure parent directory exists
      const dir = result.path.substring(0, result.path.lastIndexOf("/"));
      if (dir) {
        ensureDirectory(pyodide, dir);
      }

      if (typeof result.data === "string") {
        pyodide.FS.writeFile(result.path, result.data);
      } else {
        pyodide.FS.writeFile(result.path, result.data);
      }
    } catch (error) {
      console.error(`Failed to render plotly figure from ${entry}:`, error);
    }
  }

  // Clean up manifests
  clearRenderQueue(pyodide);
}
