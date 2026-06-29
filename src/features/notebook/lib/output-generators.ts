/**
 * Per-type output generators for the notebook studio.
 *
 * Each generator drives one `NotebookOutput` type to completion. They all share
 * the shape `(ctx: GenerateContext, styleId?: string) => Promise<Partial<NotebookOutput>>`
 * — the returned partial is merged onto the placeholder output by the caller.
 *
 * Progressive updates (e.g. slide-by-slide streaming) are delivered via
 * `ctx.onProgress(partial)` so the UI can reflect in-flight results before the
 * generator resolves.
 */

import { z } from "zod/v3";
import { getConfig } from "@/shared/config";
import { run } from "@/shared/lib/agent";
import type { Client } from "@/shared/lib/client";
import { blobToDataUrl } from "@/shared/lib/opfs-core";
import type { Tool } from "@/shared/types/chat";
import { getTextFromContent } from "@/shared/types/chat";
import type { File } from "@/shared/types/file";
import type { MindMapNode, NotebookOutput } from "../types/notebook";
import { assembleSlideHtml, getOrderedHtmlSlides } from "./html-slide-assembly";
import { createHtmlSlideTools, pruneSlideWriteHistory } from "./html-slide-tools";
import { notebookImageOptions } from "./image-options";
import { type BuildInstructionsOptions, buildSlidePrompts, podcastStyles } from "./styles";
import { mergeWavBlobs } from "./wav-utils";

export interface GenerateContext {
  client: Client;
  model: string;
  instructions: string;
  sourceTools: Tool[];
  getSources: () => File[];
  /** Called with partial updates while the generator is still running. */
  onProgress: (partial: Partial<NotebookOutput>) => void;
}

type Result = Partial<NotebookOutput>;

const USER_MESSAGE = (label: string) => ({
  role: "user" as const,
  content: [{ type: "text" as const, text: `Generate a ${label.toLowerCase()} from the available sources.` }],
});

/** Run `fn` over `items` with at most `limit` calls in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Podcast ────────────────────────────────────────────────────────────

export async function generatePodcast(ctx: GenerateContext, styleId?: string): Promise<Result> {
  const config = getConfig();
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Podcast")], ctx.sourceTools);
  const script = getTextFromContent(result[result.length - 1].content);
  if (!script?.trim()) throw new Error("Could not generate audio script");

  // Surface the script immediately — TTS can run for minutes, and if it fails
  // the persisted error output still carries the (expensive) script.
  ctx.onProgress({ content: script });

  const ttsModel = config.tts?.model || "";
  const voiceMap = config.tts?.voices ?? {};
  const resolveVoice = (role: string) => voiceMap[role] || role;
  const voices = podcastStyles.get(styleId)?.voices ?? ["host"];

  // Parse script into segments. Multi-voice styles use [1]/[2] speaker tags;
  // single-voice styles treat every paragraph as a segment.
  const paragraphs = script
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const segments: { text: string; voice: string }[] = [];
  if (voices.length > 1) {
    const tagPattern = /^\[(\d+)\]\s*/;
    for (const para of paragraphs) {
      const match = para.match(tagPattern);
      if (match) {
        const idx = Math.min(parseInt(match[1], 10) - 1, voices.length - 1);
        segments.push({ text: para.replace(tagPattern, ""), voice: voices[Math.max(0, idx)] });
      } else {
        segments.push({ text: para, voice: voices[0] });
      }
    }
  } else {
    for (const para of paragraphs) segments.push({ text: para, voice: voices[0] });
  }

  // Bounded concurrency (TTS endpoints rate-limit) with one retry per segment.
  // Failures are loud: silently skipping a failed segment would splice
  // sentences out of the middle of the podcast.
  const audioBlobs = await mapWithConcurrency(segments, 4, async ({ text, voice }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ctx.client.generateAudio(ttsModel, text, resolveVoice(voice));
      } catch (err) {
        if (attempt === 1) console.error("TTS segment failed after retry:", err);
      }
    }
    return null;
  });

  const validBlobs = audioBlobs.filter((b): b is Blob => b !== null);
  if (validBlobs.length < segments.length) {
    throw new Error(`Failed to generate ${segments.length - validBlobs.length} of ${segments.length} audio segments`);
  }

  const merged = await mergeWavBlobs(validBlobs);
  const audioUrl = await blobToDataUrl(merged);

  return { content: script, audioUrl };
}

// ── Infographic ────────────────────────────────────────────────────────

export async function generateInfographic(ctx: GenerateContext): Promise<Result> {
  const config = getConfig();
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Infographic")], ctx.sourceTools);
  const imagePrompt = getTextFromContent(result[result.length - 1].content);
  if (!imagePrompt?.trim()) throw new Error("Could not generate image prompt");

  const rendererModel = config.notebook?.renderer || config.renderer?.model || "";
  // An infographic is a tall, text-dense poster — render it portrait and at the
  // top quality/resolution the model offers so the type stays legible.
  const options = notebookImageOptions(rendererModel, { aspect: "2:3", quality: "high", resolution: "2K" });
  const imageBlob = await ctx.client.generateImage(rendererModel, imagePrompt, undefined, options);
  const imageUrl = await blobToDataUrl(imageBlob);

  return { content: imagePrompt, imageUrl };
}

// ── Slides — HTML mode ─────────────────────────────────────────────────

interface SlidePlanItem {
  archetype: string;
  title: string;
  brief: string;
}

const WRITER_CONCURRENCY = 3;

/**
 * Two-phase HTML deck generation:
 *
 *   Phase 1 (planner): one agent studies the sources, writes the shared
 *   `styles/theme.css`, and submits a per-slide plan via `set_deck_plan` —
 *   each brief carries the actual content (data, quotes, citations).
 *
 *   Phase 2 (writers): one small agent per slide implements its brief in
 *   parallel against the shared slide fs. Each writer only ever sees its
 *   own slide, so token cost is linear in deck size and wall-clock is
 *   bounded by the slowest slide, not the sum.
 *
 * Single-slide decks (one-pagers) keep the original single-loop flow —
 * planning a one-slide deck is pure overhead.
 */
export async function generateHtmlSlides(
  ctx: GenerateContext,
  styleId?: string,
  options?: BuildInstructionsOptions,
): Promise<Result> {
  const config = getConfig();
  const rendererModel = config.notebook?.renderer || config.renderer?.model || "";
  const slideFs = new Map<string, string>();

  const onWrite = () => {
    const rawSlides = getOrderedHtmlSlides(slideFs);
    if (rawSlides.length > 0) {
      const htmlSlides = rawSlides.map((html) => assembleSlideHtml(html, slideFs));
      ctx.onProgress({ slides: [...htmlSlides], slideContentType: "text/html" });
    }
  };

  // One-pager: the dedicated single-loop prompt already in ctx.instructions.
  if (options?.slideCount === 1) {
    const fsTools = createHtmlSlideTools(slideFs, ctx.client, rendererModel, onWrite, ctx.getSources);
    const message = {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: "Create a polished, professionally-designed slide deck from the available sources.",
        },
      ],
    };
    await run(ctx.client, ctx.model, ctx.instructions, [message], [...ctx.sourceTools, ...fsTools], {
      agentName: "notebook-slides",
      prepareMessages: pruneSlideWriteHistory,
    });
    return finishHtmlSlides(slideFs);
  }

  const { planner, writer } = await buildSlidePrompts(styleId, options);

  // ── Phase 1: plan + design system ──
  let plan: SlidePlanItem[] | null = null;
  let arc = "";

  const planTools: Tool[] = [
    {
      name: "write_file",
      description:
        "Write a stylesheet under styles/ (e.g. 'styles/theme.css'). Slides are written later by per-slide writers working from your plan.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Stylesheet path, e.g. 'styles/theme.css'" },
          content: { type: "string", description: "CSS content" },
        },
        required: ["path", "content"],
      },
      function: async (args) => {
        const path = args.path as string;
        if (!/^styles\/[\w.-]+\.css$/i.test(path)) {
          return [{ type: "text" as const, text: `Error: the planner may only write styles/*.css (got ${path}).` }];
        }
        slideFs.set(path, args.content as string);
        return [{ type: "text" as const, text: `OK: wrote ${path} (${(args.content as string).length} bytes)` }];
      },
    },
    {
      name: "set_deck_plan",
      description:
        "Submit the deck plan — one entry per slide, in order. Call after styles/theme.css is written. Calling again replaces the previous plan.",
      parameters: {
        type: "object",
        properties: {
          arc: { type: "string", description: "The chosen deck arc (e.g. 'Diagnose → Insight → Recommendation')" },
          slides: {
            type: "array",
            description: "One entry per slide, in deck order.",
            items: {
              type: "object",
              properties: {
                archetype: { type: "string", description: "Layout archetype from the menu" },
                title: { type: "string", description: "Final insight headline for the slide" },
                brief: { type: "string", description: "Self-sufficient writer brief incl. data + citations" },
              },
              required: ["archetype", "title", "brief"],
            },
          },
        },
        required: ["slides"],
      },
      function: async (args) => {
        const raw = Array.isArray(args.slides) ? (args.slides as Record<string, unknown>[]) : [];
        const slides = raw
          .filter((s) => s && typeof s === "object")
          .map((s) => ({
            archetype: String(s.archetype ?? "").trim(),
            title: String(s.title ?? "").trim(),
            brief: String(s.brief ?? "").trim(),
          }))
          .filter((s) => s.title && s.brief);
        if (slides.length === 0) {
          return [
            {
              type: "text" as const,
              text: "Error: `slides` must contain at least one {archetype, title, brief} entry.",
            },
          ];
        }
        plan = slides;
        arc = typeof args.arc === "string" ? args.arc : "";
        const themeNote = slideFs.has("styles/theme.css")
          ? ""
          : " WARNING: styles/theme.css has not been written yet — write it before finishing.";
        return [{ type: "text" as const, text: `OK: deck plan recorded (${slides.length} slides).${themeNote}` }];
      },
    },
  ];

  const planMessage = {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: "Design the deck: study the sources, write styles/theme.css, then submit the plan via set_deck_plan.",
      },
    ],
  };
  await run(ctx.client, ctx.model, planner, [planMessage], [...ctx.sourceTools, ...planTools], {
    agentName: "notebook-slides-plan",
  });

  // Cast: `plan` is assigned inside the set_deck_plan tool closure, which TS
  // control-flow analysis can't see — it still narrows to the initializer.
  const deckPlan = plan as SlidePlanItem[] | null;
  if (!deckPlan || deckPlan.length === 0) throw new Error("The planner did not produce a deck plan");
  if (!slideFs.has("styles/theme.css")) throw new Error("The planner did not produce styles/theme.css");

  const total = deckPlan.length;
  const theme = slideFs.get("styles/theme.css") ?? "";
  const spine = deckPlan.map((s, i) => `${i + 1}. ${s.title} — ${s.archetype}`).join("\n");
  const pad = (n: number) => String(n).padStart(2, "0");

  // ── Phase 2: write slides in parallel ──
  await mapWithConcurrency(deckPlan, WRITER_CONCURRENCY, async (item, i) => {
    const slidePath = `slides/slide${i + 1}.html`;
    const slideTools = createHtmlSlideTools(slideFs, ctx.client, rendererModel, onWrite, ctx.getSources, {
      restrictSlidePath: slidePath,
    });

    const text =
      `You are writing slide ${i + 1} of ${total}: "${item.title}" — archetype: ${item.archetype}.\n` +
      `Write it to ${slidePath}. Page-number caption: "${pad(i + 1)} / ${pad(total)}".\n\n` +
      (arc ? `Deck arc: ${arc}\n` : "") +
      `Deck spine:\n${spine}\n\n` +
      `Shared stylesheet (styles/theme.css — already in place, do not modify):\n\`\`\`css\n${theme}\n\`\`\`\n\n` +
      `Your brief:\n${item.brief}`;

    try {
      await run(
        ctx.client,
        ctx.model,
        writer,
        [{ role: "user" as const, content: [{ type: "text" as const, text }] }],
        [...ctx.sourceTools, ...slideTools],
        { agentName: "notebook-slides-write", prepareMessages: pruneSlideWriteHistory },
      );
    } catch (error) {
      // One failed slide must not sink the deck — the gap is visible in the
      // result and the user can refine/regenerate it.
      console.error(`[HTML Slides] slide ${i + 1} failed:`, error);
    }
    if (!slideFs.has(slidePath)) {
      console.warn(`[HTML Slides] slide ${i + 1} was not written`);
    }
  });

  return finishHtmlSlides(slideFs, `${spine}`);
}

function finishHtmlSlides(slideFs: Map<string, string>, content?: string): Result {
  const rawSlides = getOrderedHtmlSlides(slideFs);
  if (rawSlides.length === 0) throw new Error("No slides generated");

  const htmlSlides = rawSlides.map((html) => assembleSlideHtml(html, slideFs));
  return {
    content: content || `${htmlSlides.length} slides generated`,
    slides: htmlSlides,
    slideContentType: "text/html",
  };
}

// ── Slides — image mode ────────────────────────────────────────────────

const IMAGE_SLIDE_CONCURRENCY = 3;

/**
 * Image-mode deck generation in two phases:
 *
 *   Phase 1 (plan): one agent studies the sources and submits the complete
 *   ordered list of slide image prompts via `set_slide_plan`.
 *
 *   Phase 2 (render): slide 1 is rendered first to establish the deck's visual
 *   identity, then the rest are rendered in parallel with slide 1 as a style
 *   reference. Collecting the prompts up front is what lets the renders fan out
 *   — the old per-slide tool loop forced them strictly sequential.
 */
export async function generateImageSlides(ctx: GenerateContext): Promise<Result> {
  const config = getConfig();
  const rendererModel = config.notebook?.renderer || config.renderer?.model || "";
  const options = notebookImageOptions(rendererModel, { aspect: "3:2", quality: "medium" });

  let plan: string[] = [];
  const planTool: Tool = {
    name: "set_slide_plan",
    description:
      "Submit the complete, ordered list of slide image prompts for the deck. Each prompt fully describes one full-bleed landscape slide — layout, text content, colours, imagery, and style. Slide 1 establishes the deck's visual identity (palette, type, motif) and the rest are rendered with it as a reference, so describe one coherent visual system across all slides.",
    parameters: {
      type: "object",
      properties: {
        slides: {
          type: "array",
          items: { type: "string", description: "Detailed image-generation prompt for one slide." },
          description: "Ordered list of slide image prompts.",
        },
      },
      required: ["slides"],
    },
    function: async (args: Record<string, unknown>) => {
      plan = Array.isArray(args.slides)
        ? args.slides.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        : [];
      return [{ type: "text" as const, text: `OK: planned ${plan.length} slides.` }];
    },
  };

  const message = {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: "Plan a visually striking, image-based slide deck from the available sources, then submit every slide's image prompt with set_slide_plan.",
      },
    ],
  };
  await run(ctx.client, ctx.model, ctx.instructions, [message], [...ctx.sourceTools, planTool]);
  if (plan.length === 0) throw new Error("No slides planned");

  const frame = (prompt: string) => `A professional full-bleed landscape presentation slide (clean design). ${prompt}`;
  const slides: (string | undefined)[] = new Array(plan.length);

  // Stream the contiguous run of finished slides from the start, so the preview
  // never shows a later slide in an earlier slot while holes are still filling.
  const emitProgress = () => {
    const done: string[] = [];
    for (const slide of slides) {
      if (!slide) break;
      done.push(slide);
    }
    if (done.length > 0) ctx.onProgress({ slides: done, slideContentType: "image/png" });
  };

  // Slide 1 first — it's the style reference every other slide builds on.
  const firstBlob = await ctx.client.generateImage(rendererModel, frame(plan[0]), undefined, options);
  slides[0] = await blobToDataUrl(firstBlob);
  emitProgress();

  // Remaining slides render concurrently against the reference. A single failed
  // slide leaves its slot empty rather than sinking the whole deck.
  await mapWithConcurrency(plan.slice(1), IMAGE_SLIDE_CONCURRENCY, async (prompt, i) => {
    try {
      const blob = await ctx.client.generateImage(rendererModel, frame(prompt), [firstBlob], options);
      slides[i + 1] = await blobToDataUrl(blob);
      emitProgress();
    } catch (err) {
      console.warn(`[Image Slides] slide ${i + 2} failed:`, err instanceof Error ? err.message : err);
    }
  });

  const ordered = slides.filter((s): s is string => Boolean(s));
  if (ordered.length === 0) throw new Error("No slides generated");

  return { content: `${ordered.length} slides generated`, slides: ordered, slideContentType: "image/png" };
}

// ── Quiz ───────────────────────────────────────────────────────────────

const quizSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correctIndex: z.number().int(),
      explanation: z.string(),
    }),
  ),
});

export async function generateQuiz(ctx: GenerateContext): Promise<Result> {
  // Step 1: tool-calling loop reads sources and drafts the quiz as text
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Quiz")], ctx.sourceTools);
  const raw = getTextFromContent(result[result.length - 1].content);
  if (!raw?.trim()) throw new Error("Could not generate quiz");

  // Step 2: structured output pass to guarantee valid JSON
  const parsed = await ctx.client.parse(
    ctx.model,
    "Convert the following quiz draft into the exact JSON structure requested. Preserve all questions, options, correct indices, and explanations.",
    raw,
    quizSchema,
    "quiz",
  );

  if (!parsed?.questions?.length) throw new Error("No questions generated");
  return { content: raw, quiz: parsed.questions };
}

// ── Mind map ───────────────────────────────────────────────────────────

// OpenAI structured output forbids self-referencing schemas, so the tree is
// expressed as a flat list with parent references and reconstructed below.
const mindMapFlatSchema = z
  .object({
    nodes: z.array(
      z
        .object({
          id: z.string(),
          parentId: z.string().nullable(),
          label: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

function buildMindMapTree(flat: { id: string; parentId: string | null; label: string }[]): MindMapNode | null {
  if (flat.length === 0) return null;
  const byId = new Map<string, MindMapNode>(flat.map((n) => [n.id, { label: n.label }]));
  let root: MindMapNode | null = null;
  for (const n of flat) {
    const node = byId.get(n.id);
    if (!node) continue;
    if (n.parentId === null || n.parentId === "" || !byId.has(n.parentId)) {
      root ??= node;
      continue;
    }
    const parent = byId.get(n.parentId);
    if (!parent) continue;
    parent.children ??= [];
    parent.children.push(node);
  }
  return root ?? byId.get(flat[0].id) ?? null;
}

export async function generateMindMap(ctx: GenerateContext): Promise<Result> {
  // Step 1: tool-calling loop reads sources and drafts the mind map as text
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Mind Map")], ctx.sourceTools);
  const raw = getTextFromContent(result[result.length - 1].content);
  if (!raw?.trim()) throw new Error("Could not generate mind map");

  // Step 2: structured output pass — ask for a flat node list with parent ids.
  const parsed = await ctx.client.parse(
    ctx.model,
    "Convert the following mind map into a flat list of nodes. Assign each node a unique `id` string, a `label`, and a `parentId` referring to its parent's id (use null for the root). Include every node from the source mind map and preserve the full hierarchy.",
    raw,
    mindMapFlatSchema,
    "mindmap",
  );

  if (!parsed?.nodes?.length) throw new Error("Invalid mind map structure");
  const tree = buildMindMapTree(parsed.nodes);
  if (!tree) throw new Error("Invalid mind map structure");
  return { content: raw, mindMap: tree };
}

// ── Report / default text ──────────────────────────────────────────────

export async function generateText(ctx: GenerateContext, label: string): Promise<Result> {
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE(label)], ctx.sourceTools);
  const content = getTextFromContent(result[result.length - 1].content);
  if (!content?.trim()) throw new Error("Could not generate output");
  return { content };
}
