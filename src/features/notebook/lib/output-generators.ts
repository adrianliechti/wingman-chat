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
import { createImageSlideTools } from "./image-slide-tools";
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
  const imageBlob = await ctx.client.generateImage(rendererModel, imagePrompt);
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
  console.log(`[HTML Slides] Plan ready — ${total} slides. Writing with concurrency ${WRITER_CONCURRENCY}.`);

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
  console.log("[HTML Slides] Generation complete, slides:", rawSlides.length);
  if (rawSlides.length === 0) throw new Error("No slides generated");

  const htmlSlides = rawSlides.map((html) => assembleSlideHtml(html, slideFs));
  return {
    content: content || `${htmlSlides.length} slides generated`,
    slides: htmlSlides,
    slideContentType: "text/html",
  };
}

// ── Slides — image mode ────────────────────────────────────────────────

export async function generateImageSlides(ctx: GenerateContext): Promise<Result> {
  const config = getConfig();
  const rendererModel = config.notebook?.renderer || config.renderer?.model || "";
  const slideMap = new Map<number, string>();

  const imgTools = createImageSlideTools(slideMap, ctx.client, rendererModel, () => {
    const ordered = Array.from(slideMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, url]) => url);
    if (ordered.length > 0) {
      ctx.onProgress({ slides: [...ordered], slideContentType: "image/png" });
    }
  });

  const message = {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: "Create a visually striking slide deck from the available sources. Generate each slide as an AI-generated image.",
      },
    ],
  };

  await run(ctx.client, ctx.model, ctx.instructions, [message], [...ctx.sourceTools, ...imgTools]);

  const ordered = Array.from(slideMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, url]) => url);
  console.log("[Image Slides] Generation complete, slides:", ordered.length);
  if (ordered.length === 0) throw new Error("No slides generated");

  return {
    content: `${ordered.length} slides generated`,
    slides: ordered,
    slideContentType: "image/png",
  };
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
