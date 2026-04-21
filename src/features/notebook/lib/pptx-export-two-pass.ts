/**
 * Two-pass HTML→PPTX export.
 *
 * Pass 1 (static, fast): DOM-parse each HTML slide and generate draft
 *   PPTX XML with extracted images/charts.
 * Pass 2 (LLM, per-slide): Refine each draft's layout, sizing, and
 *   formatting. Falls back to the draft if refinement fails.
 */

import type { Client } from "@/shared/lib/client";
import { downloadFromUrl } from "@/shared/lib/utils";
import type { Tool } from "@/shared/types/chat";
import { assemblePptx } from "./pptx-slide-assembly";
import { parseAndBuildSlide } from "./pptx-static-parser";
import { createPptxSlideTools } from "./pptx-slide-tools";
import { runWithTools } from "./tool-loop";

import studioSlidePptxInstructions from "../prompts/studio-slide-deck-pptx.txt?raw";
import slideCommonRules from "../prompts/slide-style-common.txt?raw";

export type ExportProgress = (
  current: number,
  total: number,
  phase?: "parsing" | "refining",
) => void;

export async function exportHtmlSlidesAsEditablePptx(
  htmlSlides: string[],
  slug: string,
  client: Client,
  model: string,
  onProgress?: ExportProgress,
): Promise<void> {
  const slideFs = new Map<string, string>();
  const mediaRegistry = new Map<string, string>();
  const total = htmlSlides.length;

  // ── Pass 1: Static parsing ────────────────────────────────────────────
  onProgress?.(0, total, "parsing");

  for (let i = 0; i < total; i++) {
    const result = await parseAndBuildSlide(htmlSlides[i], i + 1);

    // Store draft XML
    slideFs.set(`slides/slide${i + 1}.xml`, result.xml);

    // Store extracted images in media registry
    for (const [filename, dataUrl] of result.images) {
      mediaRegistry.set(filename, dataUrl);
      slideFs.set(`media/${filename}`, dataUrl);
    }

    onProgress?.(i + 1, total, "parsing");
  }

  // Save drafts for fallback
  const draftFs = new Map(slideFs);

  // ── Pass 2: LLM refinement ───────────────────────────────────────────
  const pptxTools = createPptxSlideTools(slideFs, mediaRegistry, client, "", () => {});
  const writeTools = pptxTools.filter(
    (t) => t.name === "write_slide" || t.name === "read_slide" || t.name === "list_slides",
  );

  const systemPrompt = buildRefinementPrompt();

  for (let i = 0; i < total; i++) {
    onProgress?.(i, total, "refining");

    const slideKey = `slides/slide${i + 1}.xml`;
    const draftXml = draftFs.get(slideKey);
    if (!draftXml) continue;

    // Collect image tokens available for this slide
    const imgTokens: string[] = [];
    for (const key of mediaRegistry.keys()) {
      if (key.startsWith(`s${i + 1}_`)) {
        const name = key.replace(/\.[^.]+$/, "");
        imgTokens.push(`img_${name}`);
      }
    }

    const userMessage = buildSlideRefinementMessage(
      i + 1,
      htmlSlides[i],
      draftXml,
      imgTokens,
    );

    // Track whether the LLM successfully wrote
    let refined = false;
    const trackedTools: Tool[] = writeTools.map((t) => {
      if (t.name === "write_slide") {
        return {
          ...t,
          function: async (args, ctx) => {
            const result = await t.function(args, ctx);
            const text = result[0]?.type === "text" ? result[0].text : "";
            if (text.startsWith("OK:")) refined = true;
            return result;
          },
        };
      }
      return t;
    });

    try {
      await runWithTools(client, model, systemPrompt, [userMessage], trackedTools, undefined, { effort: "low" });
    } catch (err) {
      console.warn(`[PPTX Export] LLM refinement failed for slide ${i + 1}:`, err);
    }

    // Fallback to draft if LLM didn't produce valid output
    if (!refined) {
      console.log(`[PPTX Export] Using draft for slide ${i + 1}`);
      slideFs.set(slideKey, draftFs.get(slideKey)!);
    }

    onProgress?.(i + 1, total, "refining");
  }

  // ── Assembly ──────────────────────────────────────────────────────────
  const blob = await assemblePptx(slideFs, mediaRegistry);
  const url = URL.createObjectURL(blob);
  downloadFromUrl(url, `${slug}.pptx`);
  URL.revokeObjectURL(url);
}

// ── Prompt builders ─────────────────────────────────────────────────────────

function buildRefinementPrompt(): string {
  const pptxRef = studioSlidePptxInstructions
    .replace("{{COMMON_RULES}}", slideCommonRules)
    .replace("{{STYLE_SECTION}}", "Match the visual style from the original HTML.");

  return [
    "You are refining a machine-generated PPTX XML slide. The XML was auto-converted from HTML and has correct content but likely has layout issues.",
    "",
    "## What to fix",
    "- Element positioning and sizes (use proper EMU coordinates)",
    "- Text bounding boxes that are too small (text gets cut off) or too large",
    "- Font sizes that don't match the visual hierarchy",
    "- Spacing between elements (avoid overlaps, ensure breathing room)",
    "- Background colors and accent shapes",
    "",
    "## What to preserve",
    "- ALL text content — do not add, remove, or reword anything",
    "- ALL image references (img_* tokens) — only adjust position/size",
    "- The slide's overall structure and intent",
    "",
    "## Process",
    "1. Compare the draft XML against the original HTML to understand the intended layout",
    "2. Fix positioning, sizing, and formatting issues",
    "3. Call write_slide ONCE with the corrected XML",
    "",
    "--- PPTX XML Reference ---",
    "",
    pptxRef,
  ].join("\n");
}

function buildSlideRefinementMessage(
  slideNum: number,
  originalHtml: string,
  draftXml: string,
  imageTokens: string[],
): { role: "user"; content: { type: "text"; text: string }[] } {
  const parts: string[] = [
    `Refine slide${slideNum}.xml. Call write_slide once with the corrected XML.`,
    "",
    "## Original HTML (visual reference)",
    "```html",
    // Strip base64 data URLs to save tokens — images are already extracted as img_* tokens
    originalHtml.replace(/data:[^"')]+/g, "data:...stripped...").slice(0, 8000),
    "```",
    "",
    "## Draft PPTX XML (to refine)",
    "```xml",
    draftXml,
    "```",
  ];

  if (imageTokens.length > 0) {
    parts.push("", "## Available images");
    for (const token of imageTokens) {
      parts.push(`- ${token}`);
    }
  }

  return {
    role: "user" as const,
    content: [{ type: "text" as const, text: parts.join("\n") }],
  };
}
