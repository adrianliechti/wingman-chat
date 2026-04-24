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

import { getConfig } from "@/shared/config";
import { run } from "@/shared/lib/agent";
import type { Client } from "@/shared/lib/client";
import { blobToDataUrl } from "@/shared/lib/opfs-core";
import type { Tool } from "@/shared/types/chat";
import { getTextFromContent } from "@/shared/types/chat";
import type { File } from "@/shared/types/file";
import type { MindMapNode, NotebookOutput, QuizQuestion } from "../types/notebook";
import { assembleSlideHtml, getOrderedHtmlSlides } from "./html-slide-assembly";
import { createHtmlSlideTools } from "./html-slide-tools";
import { createImageSlideTools } from "./image-slide-tools";
import { podcastStyles } from "./styles";
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

function stripJsonFence(raw: string): string {
  return raw
    .replace(/^```json?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// ── Podcast ────────────────────────────────────────────────────────────

export async function generatePodcast(ctx: GenerateContext, styleId?: string): Promise<Result> {
  const config = getConfig();
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Podcast")], ctx.sourceTools);
  const script = getTextFromContent(result[result.length - 1].content);
  if (!script?.trim()) throw new Error("Could not generate audio script");

  const ttsModel = config.tts?.model || "";
  const voiceMap = config.tts?.voices ?? {};
  const resolveVoice = (role: string) => voiceMap[role] || role;
  const voices = podcastStyles.get(styleId).voices ?? ["host"];

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

  const audioBlobs = await Promise.all(
    segments.map(async ({ text, voice }) => {
      try {
        return await ctx.client.generateAudio(ttsModel, text, resolveVoice(voice));
      } catch {
        return null;
      }
    }),
  );

  const validBlobs = audioBlobs.filter((b): b is Blob => b !== null);
  if (validBlobs.length === 0) throw new Error("Failed to generate audio");

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

export async function generateHtmlSlides(ctx: GenerateContext): Promise<Result> {
  const config = getConfig();
  const rendererModel = config.notebook?.renderer || config.renderer?.model || "";
  const slideFs = new Map<string, string>();

  const fsTools = createHtmlSlideTools(
    slideFs,
    ctx.client,
    rendererModel,
    () => {
      const rawSlides = getOrderedHtmlSlides(slideFs);
      if (rawSlides.length > 0) {
        const htmlSlides = rawSlides.map((html) => assembleSlideHtml(html, slideFs));
        ctx.onProgress({ slides: [...htmlSlides], slideContentType: "text/html" });
      }
    },
    ctx.getSources,
  );

  const message = {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: "Create a polished, professionally-designed slide deck from the available sources.",
      },
    ],
  };

  await run(ctx.client, ctx.model, ctx.instructions, [message], [...ctx.sourceTools, ...fsTools]);

  const rawSlides = getOrderedHtmlSlides(slideFs);
  console.log("[HTML Slides] Generation complete, slides:", rawSlides.length);
  if (rawSlides.length === 0) throw new Error("No slides generated");

  const htmlSlides = rawSlides.map((html) => assembleSlideHtml(html, slideFs));
  return {
    content: `${htmlSlides.length} slides generated`,
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

export async function generateQuiz(ctx: GenerateContext): Promise<Result> {
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Quiz")], ctx.sourceTools);
  const raw = getTextFromContent(result[result.length - 1].content);
  if (!raw?.trim()) throw new Error("Could not generate quiz");

  const parsed = JSON.parse(stripJsonFence(raw)) as { questions: QuizQuestion[] };
  if (!parsed.questions?.length) throw new Error("No questions generated");

  return { content: raw, quiz: parsed.questions };
}

// ── Mind map ───────────────────────────────────────────────────────────

export async function generateMindMap(ctx: GenerateContext): Promise<Result> {
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Mind Map")], ctx.sourceTools);
  const raw = getTextFromContent(result[result.length - 1].content);
  if (!raw?.trim()) throw new Error("Could not generate mind map");

  const parsed = JSON.parse(stripJsonFence(raw)) as MindMapNode;
  if (!parsed.label) throw new Error("Invalid mind map structure");

  return { content: raw, mindMap: parsed };
}

// ── Report / default text ──────────────────────────────────────────────

export async function generateText(ctx: GenerateContext, label: string): Promise<Result> {
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE(label)], ctx.sourceTools);
  const content = getTextFromContent(result[result.length - 1].content);
  if (!content?.trim()) throw new Error("Could not generate output");
  return { content };
}
