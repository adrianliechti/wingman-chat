/**
 * In-memory filesystem tools for HTML slide generation.
 * The LLM uses these tools to write CSS, HTML slides, and generate images.
 */

import type { Client } from "@/shared/lib/client";
import { blobToDataUrl } from "@/shared/lib/opfs-core";
import type { TextContent, Tool } from "@/shared/types/chat";
import { assembleSlideHtml } from "./html-slide-assembly";

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const OVERFLOW_TOLERANCE = 8; // px – ignore sub-pixel rounding noise

interface SlideMeasurement {
  contentWidth: number;
  contentHeight: number;
  overflow: { top: number; right: number; bottom: number; left: number };
}

const NO_MEASUREMENT: SlideMeasurement = {
  contentWidth: 0, contentHeight: 0,
  overflow: { top: 0, right: 0, bottom: 0, left: 0 },
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

        // Remove all fixed-size / overflow constraints for measurement
        for (const el of [doc.documentElement, doc.body]) {
          el.style.setProperty("height", "auto", "important");
          el.style.setProperty("overflow", "visible", "important");
        }
        slide.style.setProperty("width", "auto", "important");
        slide.style.setProperty("min-width", CANVAS_W + "px", "important");
        slide.style.setProperty("height", "auto", "important");
        slide.style.setProperty("overflow", "visible", "important");

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

        // Also consider scroll dimensions (catches padding/margin overflow
        // that may not produce a positioned descendant)
        const contentW = Math.max(slide.scrollWidth, maxRight - origin.left);
        const contentH = Math.max(slide.scrollHeight, maxBottom - origin.top);

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
): Tool[] {
  const textResult = (text: string): TextContent[] => [{ type: "text", text }];

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
            `[HTML Slides] ${path} measured ${m.contentWidth}×${m.contentHeight}px` +
            ` (canvas ${CANVAS_W}×${CANVAS_H}) → overflow T:${ov.top} R:${ov.right} B:${ov.bottom} L:${ov.left}`,
          );
          const issues: string[] = [];
          if (ov.top > OVERFLOW_TOLERANCE) issues.push(`Top: ${ov.top}px above the slide`);
          if (ov.bottom > OVERFLOW_TOLERANCE) issues.push(`Bottom: ${ov.bottom}px below the slide`);
          if (ov.left > OVERFLOW_TOLERANCE) issues.push(`Left: ${ov.left}px outside left edge`);
          if (ov.right > OVERFLOW_TOLERANCE) issues.push(`Right: ${ov.right}px outside right edge`);
          if (issues.length > 0) {
            return textResult(
              `Wrote ${path} (${content.length} bytes)\n\n` +
              `⚠️ OVERFLOW: Content extends beyond the ${CANVAS_W}×${CANVAS_H}px canvas:\n` +
              issues.map((i) => `  - ${i}`).join("\n") + "\n" +
              `Overflowing content will be clipped. Rewrite this slide to fit within the canvas bounds.`,
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
      description: "List all files that have been written so far.",
      parameters: { type: "object", properties: {}, required: [] },
      function: async () => {
        const files = [...fs.keys()].sort();
        if (files.length === 0) return textResult("No files written yet.");
        return textResult(
          files
            .map((f) => {
              const content = fs.get(f)!;
              const isImage = f.startsWith("images/");
              const size = isImage ? "(image)" : `(${content.length} bytes)`;
              return `- ${f} ${size}`;
            })
            .join("\n"),
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
