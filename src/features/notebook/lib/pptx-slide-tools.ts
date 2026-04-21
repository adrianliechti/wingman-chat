/**
 * PPTX slide CRUD tools for LLM-driven slide generation.
 *
 * The LLM writes raw OOXML `<p:sld>` documents and references images via
 * stable `r:embed="img_<name>"` tokens. Images are stored in a shared media
 * registry and resolved to real relationship IDs at assembly time.
 */

import type { Client } from "@/shared/lib/client";
import { blobToDataUrl } from "@/shared/lib/opfs-core";
import type { TextContent, Tool } from "@/shared/types/chat";

// ── Validation ──────────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: { shapes: number; images: number; textBoxes: number };
}

/**
 * Validate a slide XML string. Checks:
 * - Well-formed XML
 * - Root is `<p:sld>` with required namespaces
 * - Contains `<p:cSld>` → `<p:spTree>`
 * - Element IDs are unique
 * - Image refs (`img_*`) have corresponding media entries
 */
export function validateSlideXml(
  xml: string,
  mediaRegistry: Map<string, string>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = { shapes: 0, images: 0, textBoxes: 0 };

  // Well-formed XML check
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      errors.push(`XML parse error: ${parseError.textContent?.slice(0, 200)}`);
      return { valid: false, errors, warnings, stats };
    }
  } catch (e) {
    errors.push(`XML parse failed: ${e instanceof Error ? e.message : "unknown"}`);
    return { valid: false, errors, warnings, stats };
  }

  // Root element
  const root = doc.documentElement;
  if (root.localName !== "sld") {
    errors.push(`Root element must be <p:sld>, got <${root.localName}>`);
  }

  // Required children
  const cSld = xml.includes("<p:cSld");
  const spTree = xml.includes("<p:spTree");
  if (!cSld) errors.push("Missing <p:cSld> element");
  if (!spTree) errors.push("Missing <p:spTree> element");

  // Unique IDs
  const idMatches = xml.matchAll(/\bid="(\d+)"/g);
  const ids = new Set<string>();
  for (const m of idMatches) {
    if (ids.has(m[1])) {
      errors.push(`Duplicate element id="${m[1]}"`);
    }
    ids.add(m[1]);
  }

  // Count element types
  const picCount = (xml.match(/<p:pic[\s>]/g) || []).length;
  const spCount = (xml.match(/<p:sp[\s>]/g) || []).length;
  const txBoxCount = (xml.match(/txBox="1"/g) || []).length;
  stats.images = picCount;
  stats.shapes = spCount - txBoxCount;
  stats.textBoxes = txBoxCount;

  // Check image references
  const imgRefs = xml.matchAll(/r:embed="(img_[^"]+)"/g);
  for (const m of imgRefs) {
    const ref = m[1];
    const name = ref.replace("img_", "");
    if (!mediaRegistry.has(name)) {
      errors.push(
        `Image reference "${ref}" has no matching media. Call add_image or add_chart first.`,
      );
    }
  }

  // Warnings
  if (spCount === 0 && picCount === 0) {
    warnings.push("Slide has no visible elements");
  }

  return { valid: errors.length === 0, errors, warnings, stats };
}

// ── Tools ───────────────────────────────────────────────────────────────────

/**
 * Create the PPTX slide tool set.
 *
 * @param fs       In-memory filesystem (`slides/slide1.xml`, `media/hero.png`, …)
 * @param media    Media registry: image name → data URL
 * @param client   API client for image generation
 * @param rendererModel  Model ID for image generation
 * @param onWrite  Callback after any write (for progressive preview)
 */
export function createPptxSlideTools(
  fs: Map<string, string>,
  media: Map<string, string>,
  client: Client,
  rendererModel: string,
  onWrite: () => void,
): Tool[] {
  const textResult = (text: string): TextContent[] => [{ type: "text", text }];

  return [
    // ── write_slide ───────────────────────────────────────────────────────
    {
      name: "write_slide",
      description:
        'Write a PPTX slide XML file. The content must be a complete <p:sld> document. ' +
        'Use paths like "slide1.xml", "slide2.xml". ' +
        'Reference images with r:embed="img_<name>" — the name must match a previously added image.',
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: 'Slide filename, e.g. "slide1.xml"',
          },
          content: {
            type: "string",
            description: "Complete <p:sld> XML document",
          },
        },
        required: ["filename", "content"],
      },
      function: async (args) => {
        const filename = args.filename as string;
        const content = args.content as string;
        const path = `slides/${filename}`;

        // Validate
        const result = validateSlideXml(content, media);
        if (!result.valid) {
          return textResult(
            `VALIDATION ERROR — slide NOT saved:\n${result.errors.map((e) => `• ${e}`).join("\n")}\n\nFix the errors and call write_slide again.`,
          );
        }

        fs.set(path, content);
        console.log(
          `[PPTX] Wrote ${path} (${content.length} bytes, ${result.stats.textBoxes} text, ${result.stats.shapes} shapes, ${result.stats.images} images)`,
        );
        onWrite();

        const parts = [
          `OK: wrote ${path}`,
          `Elements: ${result.stats.textBoxes} text boxes, ${result.stats.shapes} shapes, ${result.stats.images} images`,
        ];
        if (result.warnings.length > 0) {
          parts.push(`Warnings: ${result.warnings.join("; ")}`);
        }
        return textResult(parts.join("\n"));
      },
    },

    // ── read_slide ────────────────────────────────────────────────────────
    {
      name: "read_slide",
      description: "Read a previously written slide XML file.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: 'Slide filename, e.g. "slide1.xml"',
          },
        },
        required: ["filename"],
      },
      function: async (args) => {
        const filename = args.filename as string;
        const content = fs.get(`slides/${filename}`);
        if (!content) return textResult(`Error: slides/${filename} not found`);
        return textResult(content);
      },
    },

    // ── list_slides ───────────────────────────────────────────────────────
    {
      name: "list_slides",
      description: "List all slide files and media that have been written so far.",
      parameters: { type: "object", properties: {}, required: [] },
      function: async () => {
        const slides = [...fs.keys()]
          .filter((k) => k.startsWith("slides/"))
          .sort();
        const mediaFiles = [...media.keys()].sort();

        const lines: string[] = [];
        if (slides.length === 0) {
          lines.push("No slides written yet.");
        } else {
          lines.push("Slides:");
          for (const s of slides) {
            lines.push(`  - ${s} (${(fs.get(s) || "").length} bytes)`);
          }
        }
        if (mediaFiles.length > 0) {
          lines.push("Media:");
          for (const m of mediaFiles) {
            lines.push(`  - ${m} (ref: img_${m.replace(/\.[^.]+$/, "")})`);
          }
        }
        return textResult(lines.join("\n"));
      },
    },

    // ── add_image ─────────────────────────────────────────────────────────
    {
      name: "add_image",
      description:
        "Generate an image using AI and store it as PPTX media. " +
        "Returns the reference token to use in slide XML.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed image generation prompt",
          },
          name: {
            type: "string",
            description:
              'Short name for the image (no extension), e.g. "hero", "team_photo". ' +
              'Will be referenced as r:embed="img_<name>" in slide XML.',
          },
        },
        required: ["prompt", "name"],
      },
      function: async (args) => {
        const prompt = args.prompt as string;
        const name = args.name as string;

        try {
          const blob = await client.generateImage(rendererModel, prompt);
          const dataUrl = await blobToDataUrl(blob);
          const ext = dataUrl.startsWith("data:image/jpeg") ? "jpeg" : "png";
          const filename = `${name}.${ext}`;

          media.set(filename, dataUrl);
          fs.set(`media/${filename}`, dataUrl);
          console.log(`[PPTX] Generated image media/${filename}`);
          onWrite();

          return textResult(
            [
              `OK: generated and stored media/${filename}`,
              ``,
              `In your slide XML, reference it as:`,
              `  <a:blip r:embed="img_${name}"/>`,
              ``,
              `Full image element example:`,
              `<p:pic>`,
              `  <p:nvPicPr><p:cNvPr id="N" name="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`,
              `  <p:blipFill><a:blip r:embed="img_${name}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`,
              `  <p:spPr><a:xfrm><a:off x="X" y="Y"/><a:ext cx="CX" cy="CY"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`,
              `</p:pic>`,
            ].join("\n"),
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Image generation failed";
          console.warn(`[PPTX] Image generation failed for ${name}:`, msg);
          return textResult(`Error generating image: ${msg}`);
        }
      },
    },

    // ── add_chart ─────────────────────────────────────────────────────────
    {
      name: "add_chart",
      description:
        "Rasterize an SVG chart/diagram to PNG and store as PPTX media. " +
        "Provide the complete SVG markup. Returns the reference token for slide XML.",
      parameters: {
        type: "object",
        properties: {
          svg: {
            type: "string",
            description: "Complete SVG markup (must include xmlns and viewBox)",
          },
          name: {
            type: "string",
            description:
              'Short name for the chart (no extension), e.g. "revenue_chart", "org_diagram". ' +
              'Will be referenced as r:embed="img_<name>" in slide XML.',
          },
          width: {
            type: "number",
            description: "Render width in pixels (default: 1200)",
          },
          height: {
            type: "number",
            description: "Render height in pixels (default: 800)",
          },
        },
        required: ["svg", "name"],
      },
      function: async (args) => {
        const svgContent = args.svg as string;
        const name = args.name as string;
        const width = (args.width as number) || 1200;
        const height = (args.height as number) || 800;

        try {
          const dataUrl = await rasterizeSvgToDataUrl(svgContent, width, height);
          if (!dataUrl) {
            return textResult("Error: SVG rasterization failed. Check your SVG markup.");
          }

          const filename = `${name}.png`;
          media.set(filename, dataUrl);
          fs.set(`media/${filename}`, dataUrl);
          console.log(`[PPTX] Rasterized chart media/${filename} (${width}×${height})`);
          onWrite();

          return textResult(
            [
              `OK: rasterized and stored media/${filename} (${width}×${height}px)`,
              ``,
              `In your slide XML, reference it as:`,
              `  <a:blip r:embed="img_${name}"/>`,
            ].join("\n"),
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : "SVG rasterization failed";
          return textResult(`Error: ${msg}`);
        }
      },
    },
  ];
}

// ── SVG rasterization helper ────────────────────────────────────────────────

async function rasterizeSvgToDataUrl(
  svgMarkup: string,
  width: number,
  height: number,
): Promise<string | null> {
  try {
    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.width = width * 2;
    img.height = height * 2;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "transparent";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, width * 2, height * 2);

    URL.revokeObjectURL(url);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
