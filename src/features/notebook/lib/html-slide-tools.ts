/**
 * In-memory filesystem tools for HTML slide generation.
 * The LLM uses these tools to write CSS, HTML slides, and generate images.
 */

import type { Client } from "@/shared/lib/client";
import { blobToDataUrl } from "@/shared/lib/opfs-core";
import type { TextContent, Tool } from "@/shared/types/chat";
import type { File } from "@/shared/types/file";
import { assembleSlideHtml } from "./html-slide-assembly";

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const OVERFLOW_TOLERANCE = 8; // px – ignore sub-pixel rounding noise

const TEXT_TAGS = new Set(["H1","H2","H3","H4","H5","H6","P","LI","SPAN","A","LABEL","FIGCAPTION","BLOCKQUOTE","TD","TH","DT","DD"]);

interface SlideMeasurement {
  contentWidth: number;
  contentHeight: number;
  overflow: { top: number; right: number; bottom: number; left: number };
  /** Fraction of the 1080px canvas used vertically by content (0–1) */
  verticalFill: number;
  /** Gap in px between slide top and first visible content */
  topGap: number;
  /** Number of overlapping text element pairs detected */
  textOverlaps: number;
  /** Length of the longest h1/h2 title text in characters */
  titleLength: number;
  /** Gap in px between last visible content and canvas bottom */
  bottomGap: number;
}

const NO_MEASUREMENT: SlideMeasurement = {
  contentWidth: 0, contentHeight: 0,
  overflow: { top: 0, right: 0, bottom: 0, left: 0 },
  verticalFill: 0, topGap: 0, bottomGap: 0, textOverlaps: 0, titleLength: 0,
};

/**
 * Render assembled slide HTML in a hidden iframe and measure content overflow
 * on all four edges (with fixed-size constraints removed via inline styles).
 * Returns zero overflow if measurement fails (e.g. non-browser environment).
 */
async function measureSlideOverflow(html: string): Promise<SlideMeasurement> {
  if (typeof document === "undefined") return NO_MEASUREMENT;

  return new Promise<SlideMeasurement>((resolve) => {
    const iframe = document.createElement("iframe");
    const timeout = setTimeout(() => { iframe.remove(); resolve(NO_MEASUREMENT); }, 5000);

    iframe.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;width:1920px;height:10000px;border:none;visibility:hidden;pointer-events:none;";

    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return; // not ready yet
        const slide = doc.querySelector(".slide") as HTMLElement | null;
        if (!slide) return; // about:blank or missing .slide — wait for next onload

        clearTimeout(timeout);

        // Remove fixed-size constraints so content that overflows the
        // canvas becomes visible to getBoundingClientRect/scroll metrics.
        // Note: we intentionally keep `.slide` at `overflow: hidden` to
        // preserve its block formatting context — otherwise the first
        // child's `margin-top` collapses through the slide and produces
        // a phantom "top overflow" that the model cannot fix.
        for (const el of [doc.documentElement, doc.body]) {
          el.style.setProperty("height", "auto", "important");
          el.style.setProperty("overflow", "visible", "important");
        }
        slide.style.setProperty("width", "auto", "important");
        slide.style.setProperty("min-width", `${CANVAS_W}px`, "important");
        slide.style.setProperty("height", "auto", "important");

        // Walk all descendants to find the true content bounding box
        const origin = slide.getBoundingClientRect();
        let minTop = origin.top;
        let minLeft = origin.left;
        let maxRight = origin.left;
        let maxBottom = origin.top;

        for (const el of slide.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          minTop = Math.min(minTop, r.top);
          minLeft = Math.min(minLeft, r.left);
          maxRight = Math.max(maxRight, r.right);
          maxBottom = Math.max(maxBottom, r.bottom);
        }

        // Detect overlapping text elements
        const textRects: DOMRect[] = [];
        for (const el of slide.querySelectorAll("*")) {
          if (!TEXT_TAGS.has(el.tagName)) continue;
          if ((el as HTMLElement).offsetHeight === 0) continue;
          // Only leaf text nodes (skip containers whose children we'll check)
          if (el.querySelector(Array.from(TEXT_TAGS).join(",")) ) continue;
          textRects.push(el.getBoundingClientRect());
        }
        let textOverlaps = 0;
        for (let i = 0; i < textRects.length; i++) {
          for (let j = i + 1; j < textRects.length; j++) {
            const a = textRects[i], b = textRects[j];
            // Check for meaningful overlap (> 4px in both axes to ignore hairline touches)
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > 4 && overlapY > 4) textOverlaps++;
          }
        }

        // Measure longest title
        let titleLength = 0;
        for (const el of slide.querySelectorAll("h1, h2")) {
          const len = (el.textContent || "").trim().length;
          if (len > titleLength) titleLength = len;
        }

        // Also consider scroll dimensions (catches padding/margin overflow
        // that may not produce a positioned descendant)
        const contentW = Math.max(slide.scrollWidth, maxRight - origin.left);
        const contentH = Math.max(slide.scrollHeight, maxBottom - origin.top);

        // Content span relative to the slide origin
        const usedTop = minTop - origin.top;
        const usedBottom = maxBottom - origin.top;
        const usedHeight = usedBottom - usedTop;

        iframe.remove();
        resolve({
          contentWidth: Math.ceil(contentW),
          contentHeight: Math.ceil(contentH),
          overflow: {
            top: Math.max(0, Math.ceil(origin.top - minTop)),
            right: Math.max(0, Math.ceil(contentW - CANVAS_W)),
            bottom: Math.max(0, Math.ceil(contentH - CANVAS_H)),
            left: Math.max(0, Math.ceil(origin.left - minLeft)),
          },
          verticalFill: Math.round((usedHeight / CANVAS_H) * 100) / 100,
          topGap: Math.max(0, Math.ceil(usedTop)),
          bottomGap: Math.max(0, Math.ceil(CANVAS_H - usedBottom)),
          textOverlaps,
          titleLength,
        });
      } catch {
        // don't resolve — let the timeout handle cleanup
      }
    };

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

export function createHtmlSlideTools(
  fs: Map<string, string>,
  client: Client,
  rendererModel: string,
  onWrite: () => void,
  getSources?: () => File[],
): Tool[] {
  const textResult = (text: string): TextContent[] => [{ type: "text", text }];

  const sanitizeFilename = (name: string): string => {
    // Strip any directory components and keep a filesystem-friendly name.
    const base = name.split(/[\\/]/).pop() ?? name;
    return base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "") || "image";
  };

  return [
    {
      name: "write_file",
      description:
        "Write a file (CSS stylesheet or HTML slide). Use paths like 'styles/theme.css' for stylesheets and 'slides/slide1.html' for slides.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path, e.g. 'styles/theme.css' or 'slides/slide1.html'",
          },
          content: {
            type: "string",
            description: "File content (CSS or HTML)",
          },
        },
        required: ["path", "content"],
      },
      function: async (args) => {
        const path = args.path as string;
        const content = args.content as string;

        fs.set(path, content);
        console.log(`[HTML Slides] Wrote ${path} (${content.length} bytes)`);
        onWrite();

        // Validate slide bounds and give model corrective feedback
        if (/^slides\/slide\d+\.html$/i.test(path)) {
          const assembled = assembleSlideHtml(content, fs);
          const m = await measureSlideOverflow(assembled);
          const { overflow: ov } = m;
          console.debug(
            `[HTML Slides] ${path} ${m.contentWidth}×${m.contentHeight}px` +
            ` fill:${Math.round(m.verticalFill * 100)}% topGap:${m.topGap} bottomGap:${m.bottomGap}` +
            ` overlaps:${m.textOverlaps} title:${m.titleLength}ch overflow T:${ov.top} R:${ov.right} B:${ov.bottom} L:${ov.left}`,
          );

          // Only report hard errors (content clipped beyond the canvas).
          // Soft layout hints (fill %, whitespace, title length) were
          // removed: they trapped the model in rewrite loops because
          // "improvement" is subjective and every new version triggers
          // a new hint.
          const errors: string[] = [];
          if (ov.top > OVERFLOW_TOLERANCE) errors.push(`Top: ${ov.top}px above the slide`);
          if (ov.bottom > OVERFLOW_TOLERANCE) errors.push(`Bottom: ${ov.bottom}px below the slide`);
          if (ov.left > OVERFLOW_TOLERANCE) errors.push(`Left: ${ov.left}px outside left edge`);
          if (ov.right > OVERFLOW_TOLERANCE) errors.push(`Right: ${ov.right}px outside right edge`);

          if (errors.length > 0) {
            return textResult(
              `Wrote ${path} (${content.length} bytes)\n\n⚠️ OVERFLOW: Content extends beyond the ${CANVAS_W}×${CANVAS_H}px canvas:\n` +
                errors.map((e) => `  - ${e}`).join("\n") +
                `\nOverflowing content will be clipped. Rewrite this slide to fit within the canvas bounds.`,
            );
          }
        }

        return textResult(`OK: wrote ${path} (${content.length} bytes)`);
      },
    },
    {
      name: "read_file",
      description: "Read a previously written file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path to read",
          },
        },
        required: ["path"],
      },
      function: async (args) => {
        const path = args.path as string;
        const content = fs.get(path);
        if (!content) return textResult(`Error: ${path} not found`);
        return textResult(content);
      },
    },
    {
      name: "list_files",
      description: "List all files that have been written so far, plus any uploaded image sources available for import via `import_image`.",
      parameters: { type: "object", properties: {}, required: [] },
      function: async () => {
        const files = [...fs.keys()].sort();
        const lines: string[] = [];
        if (files.length === 0) {
          lines.push("No files written yet.");
        } else {
          for (const f of files) {
            const content = fs.get(f) ?? "";
            const isImage = f.startsWith("images/");
            const size = isImage ? "(image)" : `(${content.length} bytes)`;
            lines.push(`- ${f} ${size}`);
          }
        }

        // Surface uploaded image sources so the model knows what can be imported.
        const sources = getSources?.() ?? [];
        const imageSources = sources.filter(
          (s) => (s.contentType ?? "").startsWith("image/") || s.content.startsWith("data:image/"),
        );
        if (imageSources.length > 0) {
          lines.push("", "Uploaded image sources (call `import_image` to use them in a slide):");
          for (const s of imageSources) {
            lines.push(`- ${s.path} (${s.contentType ?? "image"})`);
          }
        }

        return textResult(lines.join("\n"));
      },
    },
    {
      name: "import_image",
      description:
        "Copy an uploaded image source into the slide filesystem so it can be referenced in HTML/CSS. Use this instead of `generate_image` when the user has already uploaded a suitable image. Reference the result in HTML as <img src=\"images/filename.png\"> or in CSS as url('images/filename.png').",
      parameters: {
        type: "object",
        properties: {
          source_path: {
            type: "string",
            description: "The path of the uploaded image source (see `source_list_files` or `list_files`).",
          },
          filename: {
            type: "string",
            description: "Optional target filename under images/. Defaults to the source's basename.",
          },
        },
        required: ["source_path"],
      },
      function: async (args) => {
        const sourcePath = (args.source_path as string | undefined)?.trim();
        const requestedFilename = (args.filename as string | undefined)?.trim();
        if (!sourcePath) return textResult("Error: source_path is required.");

        const sources = getSources?.() ?? [];
        const source = sources.find((s) => s.path === sourcePath);
        if (!source) return textResult(`Error: no source found at ${sourcePath}.`);

        const ct = source.contentType ?? "";
        const isImage = ct.startsWith("image/") || source.content.startsWith("data:image/");
        if (!isImage) return textResult(`Error: ${sourcePath} is not an image (contentType: ${ct || "unknown"}).`);
        if (!source.content.startsWith("data:")) {
          return textResult(`Error: ${sourcePath} is not stored as a data URL and cannot be imported.`);
        }

        const filename = sanitizeFilename(requestedFilename || sourcePath);
        const path = `images/${filename}`;
        fs.set(path, source.content);
        console.log(`[HTML Slides] Imported ${sourcePath} → ${path}`);
        onWrite();
        return textResult(
          `OK: imported ${sourcePath} as ${path}. Reference it in HTML as src="images/${filename}" or in CSS as url('images/${filename}').`,
        );
      },
    },
    {
      name: "generate_image",
      description:
        "Generate an image using AI and store it. Reference it in HTML as <img src=\"images/filename.png\"> or in CSS as url('images/filename.png').",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed image generation prompt",
          },
          filename: {
            type: "string",
            description: "Filename for the image, e.g. 'hero.png' or 'chart-bg.png'",
          },
        },
        required: ["prompt", "filename"],
      },
      function: async (args) => {
        const prompt = args.prompt as string;
        const filename = args.filename as string;
        const path = `images/${filename}`;

        try {
          const blob = await client.generateImage(rendererModel, prompt);
          const dataUrl = await blobToDataUrl(blob);
          fs.set(path, dataUrl);
          console.log(`[HTML Slides] Generated image ${path}`);
          onWrite();
          return textResult(`OK: generated and stored ${path}. Reference it in HTML as src="images/${filename}" or in CSS as url('images/${filename}').`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Image generation failed";
          console.warn(`[HTML Slides] Image generation failed for ${path}:`, msg);
          return textResult(`Error generating image: ${msg}`);
        }
      },
    },
  ];
}
