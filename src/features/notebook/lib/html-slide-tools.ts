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
const OVERLAP_TOLERANCE = 4; // px – ignore sub-pixel rounding noise on text overlaps
const MIN_VERTICAL_FILL = 0.35; // below this, the slide looks empty
const MAX_REPORTED_OVERLAPS = 5; // cap so the feedback message stays actionable
const MAX_ERROR_RETRIES = 2; // total error-bearing writes per slide before we let it pass
const TITLE_CHAR_CAP = 80; // hard cap from slide-style-common.txt "Title length"
const TITLE_LINE_CAP = 2; // titles must not wrap to 3+ lines
const HEADER_HEIGHT_FRACTION_CAP = 0.25; // header (title + subtitle) ≤ 25% of canvas height

// Leaf text elements considered for overlap detection
const TEXT_TAGS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "LI",
  "SPAN",
  "A",
  "LABEL",
  "FIGCAPTION",
  "BLOCKQUOTE",
  "TD",
  "TH",
  "DT",
  "DD",
]);

interface OverlapPair {
  a: string;
  b: string;
  width: number;
  height: number;
}

interface SlideMeasurement {
  overflow: { top: number; right: number; bottom: number; left: number };
  /** Selector-like description of the element responsible for each overflow edge */
  overflowOffenders: { top?: string; right?: string; bottom?: string; left?: string };
  /** Fraction of the 1080px canvas vertically covered by content (0–1) */
  verticalFill: number;
  /** Overlapping leaf text element pairs (> OVERLAP_TOLERANCE px in both axes), sorted by area */
  textOverlaps: OverlapPair[];
  /** Title text length in characters (0 if no title found) */
  titleChars: number;
  /** Number of rendered lines the title wraps to (0 if no title found) */
  titleLines: number;
  /** Rendered height of the slide header (or title's nearest header container), in px */
  headerHeight: number;
}

const NO_MEASUREMENT: SlideMeasurement = {
  overflow: { top: 0, right: 0, bottom: 0, left: 0 },
  overflowOffenders: {},
  verticalFill: 0,
  textOverlaps: [],
  titleChars: 0,
  titleLines: 0,
  headerHeight: 0,
};

/**
 * Build a short, selector-like description of an element so the model can
 * locate it in its own source. Prefers id, then first class, falls back to
 * the tag name, and appends a short text excerpt when present.
 */
function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  let key = "";
  if (el.id) {
    key = `#${el.id}`;
  } else {
    const cls = (el as HTMLElement).classList?.[0];
    if (cls) key = `.${cls}`;
  }
  const raw = (el.textContent || "").trim().replace(/\s+/g, " ");
  const text = raw.slice(0, 30);
  const textPart = text ? ` "${text}${raw.length > 30 ? "…" : ""}"` : "";
  return `<${tag}${key}>${textPart}`;
}

/**
 * Render assembled slide HTML in a hidden iframe and measure content overflow
 * on all four edges plus a couple of objective layout signals.
 * Returns a zero measurement if measurement fails (e.g. non-browser environment).
 */
async function measureSlide(html: string): Promise<SlideMeasurement> {
  if (typeof document === "undefined") return NO_MEASUREMENT;

  return new Promise<SlideMeasurement>((resolve) => {
    const iframe = document.createElement("iframe");
    const timeout = setTimeout(() => {
      iframe.remove();
      resolve(NO_MEASUREMENT);
    }, 5000);

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

        // Walk all descendants to find the true content bounding box, and
        // remember which element pushed each edge — so we can name it back
        // to the model when it overflows.
        const origin = slide.getBoundingClientRect();
        let minTop = origin.top;
        let minLeft = origin.left;
        let maxRight = origin.left;
        let maxBottom = origin.top;
        let topEl: Element | null = null;
        let leftEl: Element | null = null;
        let rightEl: Element | null = null;
        let bottomEl: Element | null = null;

        for (const el of slide.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.top < minTop) { minTop = r.top; topEl = el; }
          if (r.left < minLeft) { minLeft = r.left; leftEl = el; }
          if (r.right > maxRight) { maxRight = r.right; rightEl = el; }
          if (r.bottom > maxBottom) { maxBottom = r.bottom; bottomEl = el; }
        }

        // Detect overlapping leaf text elements — an objective bug signal.
        // Capture the elements themselves so we can describe each colliding
        // pair to the model in the feedback message.
        const textEls: Element[] = [];
        const textRects: DOMRect[] = [];
        const leafSelector = Array.from(TEXT_TAGS).join(",");
        for (const el of slide.querySelectorAll("*")) {
          if (!TEXT_TAGS.has(el.tagName)) continue;
          if ((el as HTMLElement).offsetHeight === 0) continue;
          if (el.querySelector(leafSelector)) continue; // skip containers
          textEls.push(el);
          textRects.push(el.getBoundingClientRect());
        }
        const overlaps: OverlapPair[] = [];
        for (let i = 0; i < textRects.length; i++) {
          for (let j = i + 1; j < textRects.length; j++) {
            const a = textRects[i];
            const b = textRects[j];
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > OVERLAP_TOLERANCE && overlapY > OVERLAP_TOLERANCE) {
              overlaps.push({
                a: describeElement(textEls[i]),
                b: describeElement(textEls[j]),
                width: Math.round(overlapX),
                height: Math.round(overlapY),
              });
            }
          }
        }
        // Largest overlaps first — those are the ones a fix should target.
        overlaps.sort((x, y) => y.width * y.height - x.width * x.height);

        // Also consider scroll dimensions (catches padding/margin overflow
        // that may not produce a positioned descendant)
        const contentW = Math.max(slide.scrollWidth, maxRight - origin.left);
        const contentH = Math.max(slide.scrollHeight, maxBottom - origin.top);
        const usedHeight = maxBottom - minTop;

        const overflow = {
          top: Math.max(0, Math.ceil(origin.top - minTop)),
          right: Math.max(0, Math.ceil(contentW - CANVAS_W)),
          bottom: Math.max(0, Math.ceil(contentH - CANVAS_H)),
          left: Math.max(0, Math.ceil(origin.left - minLeft)),
        };
        const overflowOffenders: SlideMeasurement["overflowOffenders"] = {};
        if (overflow.top > OVERFLOW_TOLERANCE && topEl) overflowOffenders.top = describeElement(topEl);
        if (overflow.right > OVERFLOW_TOLERANCE && rightEl) overflowOffenders.right = describeElement(rightEl);
        if (overflow.bottom > OVERFLOW_TOLERANCE && bottomEl) overflowOffenders.bottom = describeElement(bottomEl);
        if (overflow.left > OVERFLOW_TOLERANCE && leftEl) overflowOffenders.left = describeElement(leftEl);

        // Title length / line-count check. Look for the conventional title
        // selectors first (matches the prompt's HTML structure example), and
        // fall back to the first heading on the slide so we still catch
        // long titles when the model didn't apply the .title class.
        const titleEl = (slide.querySelector(
          ".slide__header h1, .slide__header h2, h1.title, h2.title",
        ) ?? slide.querySelector("h1, h2")) as HTMLElement | null;
        let titleChars = 0;
        let titleLines = 0;
        if (titleEl && titleEl.offsetHeight > 0) {
          titleChars = (titleEl.textContent || "").trim().length;
          const lhRaw = parseFloat(getComputedStyle(titleEl).lineHeight);
          if (Number.isFinite(lhRaw) && lhRaw > 0) {
            titleLines = Math.max(1, Math.round(titleEl.offsetHeight / lhRaw));
          }
        }

        // Header height — captures title + subtitle together so we can
        // flag slides where the header dominates the canvas, even when the
        // title itself fits within char/line caps.
        const headerEl =
          (slide.querySelector(".slide__header") as HTMLElement | null) ??
          (titleEl?.closest("header") as HTMLElement | null) ??
          titleEl;
        const headerHeight = headerEl ? Math.round(headerEl.getBoundingClientRect().height) : 0;

        iframe.remove();
        resolve({
          overflow,
          overflowOffenders,
          verticalFill: Math.max(0, Math.min(1, usedHeight / CANVAS_H)),
          textOverlaps: overlaps,
          titleChars,
          titleLines,
          headerHeight,
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

  // Counts error-bearing writes per slide path. We use this to give up after
  // MAX_ERROR_RETRIES so a model that can't fix its layout doesn't loop forever.
  const errorAttempts = new Map<string, number>();

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
        onWrite();

        const isSlide = /^slides\/slide\d+\.html$/i.test(path);
        if (!isSlide) {
          console.log(`[HTML Slides] Wrote ${path} (${content.length} bytes)`);
        }

        // Validate slide bounds and give model corrective feedback
        if (isSlide) {
          const assembled = assembleSlideHtml(content, fs);
          const m = await measureSlide(assembled);
          const ov = m.overflow;

          // Hard errors — objective layout bugs the model must fix.
          //   1. Content clipped beyond the canvas.
          //   2. Text elements physically overlapping each other.
          // Both are unambiguous and have stable thresholds, so flagging
          // them as errors won't cause rewrite loops once fixed.
          const errors: string[] = [];
          const offenders = m.overflowOffenders;
          if (ov.top > OVERFLOW_TOLERANCE) {
            errors.push(`Top: ${ov.top}px above the slide${offenders.top ? ` — caused by ${offenders.top}` : ""}`);
          }
          if (ov.bottom > OVERFLOW_TOLERANCE) {
            errors.push(`Bottom: ${ov.bottom}px below the slide${offenders.bottom ? ` — caused by ${offenders.bottom}` : ""}`);
          }
          if (ov.left > OVERFLOW_TOLERANCE) {
            errors.push(`Left: ${ov.left}px outside left edge${offenders.left ? ` — caused by ${offenders.left}` : ""}`);
          }
          if (ov.right > OVERFLOW_TOLERANCE) {
            errors.push(`Right: ${ov.right}px outside right edge${offenders.right ? ` — caused by ${offenders.right}` : ""}`);
          }

          // Soft hints — taste calls, not bugs. Don't block on these.
          const hints: string[] = [];
          if (m.verticalFill > 0 && m.verticalFill < MIN_VERTICAL_FILL) {
            hints.push(
              `Content only fills ${Math.round(m.verticalFill * 100)}% of the slide height — the slide looks empty. Add more content or grow the hero element to use the canvas.`,
            );
          }
          if (m.titleLines > TITLE_LINE_CAP || m.titleChars > TITLE_CHAR_CAP) {
            hints.push(
              `Title is ${m.titleChars} chars on ${m.titleLines} line(s) — shorten to ≤ ${TITLE_CHAR_CAP} chars / ≤ ${TITLE_LINE_CAP} lines, or move qualifiers into the subtitle.`,
            );
          }
          if (m.headerHeight > 0) {
            const headerFraction = m.headerHeight / CANVAS_H;
            if (headerFraction > HEADER_HEIGHT_FRACTION_CAP) {
              hints.push(
                `Header (title + subtitle) is ${m.headerHeight}px = ${Math.round(headerFraction * 100)}% of slide height — keep ≤ ${Math.round(HEADER_HEIGHT_FRACTION_CAP * 100)}% (${Math.round(HEADER_HEIGHT_FRACTION_CAP * CANVAS_H)}px). Drop the title font size to 56–72px (display-title sizes 96–140px are for cover/section slides only) or shorten the title.`,
              );
            }
          }

          const hasErrors = errors.length > 0 || m.textOverlaps.length > 0;
          if (hasErrors) {
            const attempts = (errorAttempts.get(path) ?? 0) + 1;
            errorAttempts.set(path, attempts);

            // One structured log per error write so a developer watching the
            // console can see exactly what the model was told and how the
            // loop is progressing. Total attempts shown is MAX_ERROR_RETRIES + 1
            // (the initial write plus the retries).
            const totalBudget = MAX_ERROR_RETRIES + 1;
            const issueLines: string[] = [];
            for (const e of errors) issueLines.push(`    overflow ${e}`);
            for (const o of m.textOverlaps.slice(0, MAX_REPORTED_OVERLAPS)) {
              issueLines.push(`    overlap ${o.a} ↔ ${o.b} ${o.width}×${o.height}px`);
            }
            const moreOverlaps = m.textOverlaps.length - Math.min(MAX_REPORTED_OVERLAPS, m.textOverlaps.length);
            if (moreOverlaps > 0) issueLines.push(`    overlap …and ${moreOverlaps} more`);
            console.debug(
              `[HTML Slides] ${path} attempt ${attempts}/${totalBudget} — ` +
                `${errors.length} overflow, ${m.textOverlaps.length} overlaps ` +
                `(${content.length} bytes)\n` +
                issueLines.join("\n"),
            );

            // Give up after MAX_ERROR_RETRIES so we don't loop forever on a
            // slide the model can't fix. Report the issues but tell the
            // model to move on.
            if (attempts > MAX_ERROR_RETRIES) {
              console.warn(
                `[HTML Slides] ${path} still has issues after ${attempts} attempts — accepting and moving on.`,
              );
              return textResult(
                `Wrote ${path} (${content.length} bytes). Layout still has issues but accepting it after ${attempts} attempts — DO NOT rewrite this slide again, continue with the remaining slides.`,
              );
            }

            const parts = [`Wrote ${path} (${content.length} bytes)`];
            if (errors.length > 0) {
              parts.push(
                `\n⚠️ OVERFLOW: Content extends beyond the ${CANVAS_W}×${CANVAS_H}px canvas:\n` +
                  errors.map((e) => `  - ${e}`).join("\n") +
                  `\nOverflowing content will be clipped. Rewrite this slide to fit within the canvas bounds.`,
              );
            }
            if (m.textOverlaps.length > 0) {
              const shown = m.textOverlaps.slice(0, MAX_REPORTED_OVERLAPS);
              const more = m.textOverlaps.length - shown.length;
              parts.push(
                `\n⚠️ TEXT OVERLAP: ${m.textOverlaps.length} pair(s) of text elements physically overlap each other — text is unreadable where they collide. Fix layout (spacing, grid, or z-order) so they don't intersect:\n` +
                  shown
                    .map((o) => `  - ${o.a} overlaps ${o.b} by ${o.width}×${o.height}px`)
                    .join("\n") +
                  (more > 0 ? `\n  - …and ${more} more` : ""),
              );
            }
            if (hints.length > 0) {
              parts.push(
                `\nHints (not blocking, address only if they make the slide better):\n` +
                  hints.map((h) => `  - ${h}`).join("\n"),
              );
            }
            return textResult(parts.join(""));
          }

          // Clean write — clear the retry counter so a future edit to the
          // same slide gets a fresh budget. Surface convergence in the log
          // so a developer can see the loop actually fixed something.
          const priorAttempts = errorAttempts.get(path) ?? 0;
          errorAttempts.delete(path);
          const fillPct = Math.round(m.verticalFill * 100);
          if (priorAttempts > 0) {
            console.debug(
              `[HTML Slides] ${path} OK fill:${fillPct}% (${content.length} bytes) — ` +
                `resolved after ${priorAttempts} ${priorAttempts === 1 ? "retry" : "retries"}`,
            );
          } else {
            console.debug(`[HTML Slides] ${path} OK fill:${fillPct}% (${content.length} bytes)`);
          }

          if (hints.length > 0) {
            return textResult(
              `Wrote ${path} (${content.length} bytes)\n\nHints (not blocking, address only if they make the slide better):\n` +
                hints.map((h) => `  - ${h}`).join("\n"),
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
      description:
        "List all files that have been written so far, plus any uploaded image sources available for import via `import_image`.",
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
          return textResult(
            `OK: generated and stored ${path}. Reference it in HTML as src="images/${filename}" or in CSS as url('images/${filename}').`,
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Image generation failed";
          console.warn(`[HTML Slides] Image generation failed for ${path}:`, msg);
          return textResult(`Error generating image: ${msg}`);
        }
      },
    },
  ];
}
