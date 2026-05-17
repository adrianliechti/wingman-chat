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
import type { MindMapNode, NotebookOutput, ProcessDiagram } from "../types/notebook";
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

// ── Process diagram ────────────────────────────────────────────────────

// Process nodes are constrained to a fixed BPMN-style vocabulary so the
// React Flow renderer can map each `kind` to a concrete shape. Edges may
// be `sequence` (within a pool/lane) or `message` (across pools).
export const processNodeKinds = [
  "start",
  "end",
  "task",
  "subprocess",
  "decision",
  "parallel",
  "event",
  "data",
] as const;

// OpenAI structured outputs require every property to be present and either
// required or `.nullable()` — `.optional()` is rejected. Keep all "soft"
// fields as `nullable()` and treat `null` as absence in the normaliser.
const processSchema = z
  .object({
    title: z.string(),
    summary: z.string().nullable(),
    lanes: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
        })
        .strict(),
    ),
    nodes: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          kind: z.enum(processNodeKinds),
          lane: z.string().nullable(),
          description: z.string().nullable(),
          control: z.string().nullable(),
        })
        .strict(),
    ),
    edges: z.array(
      z
        .object({
          id: z.string(),
          source: z.string(),
          target: z.string(),
          label: z.string().nullable(),
          flow: z.enum(["sequence", "message"]).nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const PROCESS_PARSE_INSTRUCTIONS =
  "Convert the following process draft into the exact JSON structure requested. " +
  "Preserve every lane, node, and edge. " +
  "Use the exact node ids from the draft so edges still connect. " +
  "Normalise `kind` to one of: start, end, task, subprocess, decision, parallel, event, data. " +
  "If the draft is ambiguous, prefer faithfulness to the source over invention. " +
  "Omit (do not invent) `description` and `control` when the draft did not include them.";

/** Strip nulls and apply minimal repairs so the diagram renders cleanly. */
function normaliseProcess(raw: z.infer<typeof processSchema>): ProcessDiagram {
  const laneIds = new Set(raw.lanes.map((l) => l.id));
  const seenNodeIds = new Set<string>();
  const nodes = raw.nodes
    .filter((n) => {
      if (seenNodeIds.has(n.id)) return false;
      seenNodeIds.add(n.id);
      return true;
    })
    .map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      ...(n.lane && laneIds.has(n.lane) ? { lane: n.lane } : {}),
      ...(n.description ? { description: n.description } : {}),
      ...(n.control ? { control: n.control } : {}),
    }));

  const validIds = new Set(nodes.map((n) => n.id));
  const seenEdgeIds = new Set<string>();
  const edges = raw.edges
    .filter((e) => validIds.has(e.source) && validIds.has(e.target))
    .filter((e) => {
      if (seenEdgeIds.has(e.id)) return false;
      seenEdgeIds.add(e.id);
      return true;
    })
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
      ...(e.flow === "message" ? { flow: "message" as const } : {}),
    }));

  return {
    title: raw.title,
    ...(raw.summary ? { summary: raw.summary } : {}),
    lanes: raw.lanes,
    nodes,
    edges,
  };
}

export async function generateProcess(ctx: GenerateContext): Promise<Result> {
  // Step 1: tool-calling loop reads sources and drafts the process in
  // the structured-English template required by the studio prompt.
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Process")], ctx.sourceTools);
  const raw = getTextFromContent(result[result.length - 1].content);
  if (!raw?.trim()) throw new Error("Could not generate process draft");

  // Step 2: structured-output pass — convert the draft into strict JSON
  // matching the React Flow renderer's contract.
  const parsed = await ctx.client.parse(ctx.model, PROCESS_PARSE_INSTRUCTIONS, raw, processSchema, "process");
  if (!parsed?.nodes?.length) throw new Error("Invalid process structure");

  const process = normaliseProcess(parsed);
  if (process.nodes.length === 0) throw new Error("Invalid process structure");

  return { content: raw, process };
}

// ── Report / default text ──────────────────────────────────────────────

export async function generateText(ctx: GenerateContext, label: string): Promise<Result> {
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE(label)], ctx.sourceTools);
  const content = getTextFromContent(result[result.length - 1].content);
  if (!content?.trim()) throw new Error("Could not generate output");
  return { content };
}
