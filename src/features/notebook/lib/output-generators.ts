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
import type { ArchitectureDiagram, DataCatalog, MindMapNode, NotebookOutput, ProcessDiagram } from "../types/notebook";
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
export const processSchema = z
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
          inferred: z.boolean().nullable(),
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
  "Preserve every lane, node, and edge. Use the exact node ids from the draft so edges still connect. " +
  "Normalise `kind` to one of: start, end, task, subprocess, decision, parallel, event, data. " +
  "Set `inferred: true` on every node whose description in the draft is prefixed with `(inferred)` (or is otherwise marked as synthesised). Strip the `(inferred)` prefix from the description itself when you set the flag.";

/** Strip nulls and apply minimal repairs so the diagram renders cleanly. */
export function normaliseProcess(raw: z.infer<typeof processSchema>): ProcessDiagram {
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
      ...(n.inferred ? { inferred: true } : {}),
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

export async function generateProcess(ctx: GenerateContext, styleId?: string): Promise<Result> {
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

  // Stamp the style id so the renderer / exporters can pick a matching lane
  // palette. The style isn't part of the LLM contract — it's set by the
  // dispatching hook based on which style the user picked.
  if (styleId) process.style = styleId;

  return { content: raw, process };
}

// ── Architecture diagram (C4 + Deployment as tabs, or Sequence) ────────

export const architectureKinds = ["c4", "sequence"] as const;
export const architectureViews = ["c4-context", "c4-container", "c4-component", "deployment"] as const;

export const architectureElementKinds = [
  "person",
  "system",
  "external-system",
  "container",
  "component",
  "deployment-node",
  "actor",
] as const;

export const architectureRelationKinds = ["uses", "includes", "depends-on", "message", "response"] as const;

const architectureElementSchema = z
  .object({
    id: z.string(),
    kind: z.enum(architectureElementKinds),
    label: z.string(),
    technology: z.string().nullable(),
    description: z.string().nullable(),
    parent: z.string().nullable(),
    stereotype: z.string().nullable(),
    inferred: z.boolean().nullable(),
    /** Which views the element appears in. Required for `kind: "c4"`, ignored for sequence. */
    views: z.array(z.enum(architectureViews)).nullable(),
  })
  .strict();

const architectureRelationSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    label: z.string().nullable(),
    technology: z.string().nullable(),
    kind: z.enum(architectureRelationKinds).nullable(),
    order: z.number().int().nullable(),
    inferred: z.boolean().nullable(),
    views: z.array(z.enum(architectureViews)).nullable(),
  })
  .strict();

const architectureGroupSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(["system-boundary", "deployment-group"]).nullable(),
    views: z.array(z.enum(architectureViews)).nullable(),
  })
  .strict();

export const architectureSchema = z
  .object({
    title: z.string(),
    summary: z.string().nullable(),
    kind: z.enum(architectureKinds),
    elements: z.array(architectureElementSchema),
    relations: z.array(architectureRelationSchema),
    groups: z.array(architectureGroupSchema),
  })
  .strict();

const ARCH_PARSE_INSTRUCTIONS =
  "Convert the following architecture draft into the exact JSON structure requested. " +
  "Preserve every element, relation, and group. Use the exact ids from the draft so relations still connect. " +
  'For `kind: "c4"` outputs, every element / relation / group MUST have a non-empty `views` array — one or more of: c4-context, c4-container, c4-component, deployment. For `kind: "sequence"`, leave `views` null. ' +
  "Set `inferred: true` on every element / relation marked `(inferred)` in the draft; leave others null or false. " +
  "If the draft is silent on a field, return null — do not invent.";

/** Strip nulls and apply minimal repairs so the diagram renders cleanly. */
export function normaliseArchitecture(raw: z.infer<typeof architectureSchema>): ArchitectureDiagram {
  const seenElementIds = new Set<string>();
  const elements = raw.elements
    .filter((e) => {
      if (seenElementIds.has(e.id)) return false;
      seenElementIds.add(e.id);
      return true;
    })
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      ...(e.technology ? { technology: e.technology } : {}),
      ...(e.description ? { description: e.description } : {}),
      ...(e.parent ? { parent: e.parent } : {}),
      ...(e.stereotype ? { stereotype: e.stereotype } : {}),
      ...(e.inferred ? { inferred: true } : {}),
      ...(e.views && e.views.length > 0 ? { views: e.views } : {}),
    }));

  // Drop `parent` references that don't resolve to a known id (elements OR groups).
  const groupIds = new Set(raw.groups.map((g) => g.id));
  const validIds = new Set<string>([...elements.map((e) => e.id), ...groupIds]);
  for (const e of elements) {
    if (e.parent && !validIds.has(e.parent)) {
      delete (e as { parent?: string }).parent;
    }
  }

  const elementIds = new Set(elements.map((e) => e.id));
  const seenRelIds = new Set<string>();
  const relations = raw.relations
    .filter((r) => elementIds.has(r.source) && elementIds.has(r.target))
    .filter((r) => {
      if (seenRelIds.has(r.id)) return false;
      seenRelIds.add(r.id);
      return true;
    })
    .map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      ...(r.label ? { label: r.label } : {}),
      ...(r.technology ? { technology: r.technology } : {}),
      ...(r.kind ? { kind: r.kind } : {}),
      ...(r.order !== null && r.order !== undefined ? { order: r.order } : {}),
      ...(r.inferred ? { inferred: true } : {}),
      ...(r.views && r.views.length > 0 ? { views: r.views } : {}),
    }));

  const groups = raw.groups.map((g) => ({
    id: g.id,
    label: g.label,
    ...(g.kind ? { kind: g.kind } : {}),
    ...(g.views && g.views.length > 0 ? { views: g.views } : {}),
  }));

  return {
    title: raw.title,
    ...(raw.summary ? { summary: raw.summary } : {}),
    kind: raw.kind,
    elements,
    relations,
    groups,
  };
}

export async function generateArchitecture(ctx: GenerateContext): Promise<Result> {
  // The chosen style ("c4" or "sequence") is in the system prompt; the
  // schema enforces `kind` to one of the architectureKinds enum values.
  const result = await run(
    ctx.client,
    ctx.model,
    ctx.instructions,
    [USER_MESSAGE("Architecture diagram")],
    ctx.sourceTools,
  );
  const raw = getTextFromContent(result[result.length - 1].content);
  if (!raw?.trim()) throw new Error("Could not generate architecture draft");

  const parsed = await ctx.client.parse(ctx.model, ARCH_PARSE_INSTRUCTIONS, raw, architectureSchema, "architecture");
  if (!parsed?.elements?.length) throw new Error("Invalid architecture structure");

  const architecture = normaliseArchitecture(parsed);
  if (architecture.elements.length === 0) throw new Error("Invalid architecture structure");

  return { content: raw, architecture };
}

// ── Data catalog (DCAT / SKOS+FIBO / OpenLineage / ODCS) ───────────────

export const dataCatalogKinds = ["inventory", "glossary", "lineage", "contracts"] as const;
export const lineageNodeKinds = ["dataset", "job", "external"] as const;
export const lineageEdgeKinds = ["ingest", "transform", "publish", "replicate"] as const;

const datasetFieldSchema = z
  .object({
    name: z.string(),
    type: z.string().nullable(),
    description: z.string().nullable(),
    classification: z.string().nullable(),
    nullable: z.boolean().nullable(),
    primaryKey: z.boolean().nullable(),
  })
  .strict();

const datasetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    domain: z.string().nullable(),
    system: z.string().nullable(),
    location: z.string().nullable(),
    refreshCadence: z.string().nullable(),
    sla: z.string().nullable(),
    fields: z.array(datasetFieldSchema).nullable(),
    owner: z.string().nullable(),
    steward: z.string().nullable(),
    contact: z.string().nullable(),
    sensitivity: z.string().nullable(),
    regulatoryTags: z.array(z.string()).nullable(),
    glossaryTerms: z.array(z.string()).nullable(),
    inferred: z.boolean().nullable(),
  })
  .strict();

const glossaryTermSchema = z
  .object({
    id: z.string(),
    term: z.string(),
    definition: z.string(),
    ontologyReference: z.string().nullable(),
    synonyms: z.array(z.string()).nullable(),
    parent: z.string().nullable(),
    datasets: z.array(z.string()).nullable(),
    inferred: z.boolean().nullable(),
  })
  .strict();

const lineageNodeSchema = z
  .object({
    id: z.string(),
    kind: z.enum(lineageNodeKinds),
    label: z.string(),
    datasetId: z.string().nullable(),
    technology: z.string().nullable(),
    description: z.string().nullable(),
    inferred: z.boolean().nullable(),
  })
  .strict();

const lineageEdgeSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    kind: z.enum(lineageEdgeKinds).nullable(),
    label: z.string().nullable(),
    inferred: z.boolean().nullable(),
  })
  .strict();

const dataContractTermSchema = z
  .object({
    term: z.string(),
    commitment: z.string(),
  })
  .strict();

const dataContractSchema = z
  .object({
    datasetId: z.string(),
    version: z.string().nullable(),
    purpose: z.string().nullable(),
    qualityRules: z.array(z.string()).nullable(),
    terms: z.array(dataContractTermSchema).nullable(),
    inferred: z.boolean().nullable(),
  })
  .strict();

export const dataCatalogSchema = z
  .object({
    title: z.string(),
    summary: z.string().nullable(),
    kind: z.enum(dataCatalogKinds),
    datasets: z.array(datasetSchema),
    glossary: z.array(glossaryTermSchema),
    lineageNodes: z.array(lineageNodeSchema),
    lineageEdges: z.array(lineageEdgeSchema),
    contracts: z.array(dataContractSchema),
  })
  .strict();

const DATA_CATALOG_PARSE_INSTRUCTIONS =
  "Convert the following data-catalog draft into the exact JSON structure requested. " +
  "Preserve every dataset, glossary term, lineage node/edge, and contract from the draft. " +
  "Use the exact ids from the draft so cross-references still resolve. " +
  "Set `inferred: true` on every entity the draft marked as inferred (or with `(inferred)` in the description). " +
  "For fields not present in the draft, return null — do not invent.";

/** Drop nulls, drop dangling cross-references, dedupe ids. */
export function normaliseDataCatalog(raw: z.infer<typeof dataCatalogSchema>): DataCatalog {
  const datasetIds = new Set<string>();
  const datasets = raw.datasets
    .filter((d) => {
      if (datasetIds.has(d.id)) return false;
      datasetIds.add(d.id);
      return true;
    })
    .map((d) => ({
      id: d.id,
      name: d.name,
      title: d.title,
      ...(d.description ? { description: d.description } : {}),
      ...(d.domain ? { domain: d.domain } : {}),
      ...(d.system ? { system: d.system } : {}),
      ...(d.location ? { location: d.location } : {}),
      ...(d.refreshCadence ? { refreshCadence: d.refreshCadence } : {}),
      ...(d.sla ? { sla: d.sla } : {}),
      ...(d.fields && d.fields.length > 0
        ? {
            fields: d.fields.map((f) => ({
              name: f.name,
              ...(f.type ? { type: f.type } : {}),
              ...(f.description ? { description: f.description } : {}),
              ...(f.classification ? { classification: f.classification } : {}),
              ...(f.nullable !== null && f.nullable !== undefined ? { nullable: f.nullable } : {}),
              ...(f.primaryKey ? { primaryKey: true } : {}),
            })),
          }
        : {}),
      ...(d.owner ? { owner: d.owner } : {}),
      ...(d.steward ? { steward: d.steward } : {}),
      ...(d.contact ? { contact: d.contact } : {}),
      ...(d.sensitivity ? { sensitivity: d.sensitivity } : {}),
      ...(d.regulatoryTags && d.regulatoryTags.length > 0 ? { regulatoryTags: d.regulatoryTags } : {}),
      ...(d.glossaryTerms && d.glossaryTerms.length > 0 ? { glossaryTerms: d.glossaryTerms } : {}),
      ...(d.inferred ? { inferred: true } : {}),
    }));

  const validDatasetIds = new Set(datasets.map((d) => d.id));
  const termIds = new Set<string>();
  const glossary = raw.glossary
    .filter((t) => {
      if (termIds.has(t.id)) return false;
      termIds.add(t.id);
      return true;
    })
    .map((t) => ({
      id: t.id,
      term: t.term,
      definition: t.definition,
      ...(t.ontologyReference ? { ontologyReference: t.ontologyReference } : {}),
      ...(t.synonyms && t.synonyms.length > 0 ? { synonyms: t.synonyms } : {}),
      ...(t.parent ? { parent: t.parent } : {}),
      ...(t.datasets && t.datasets.length > 0 ? { datasets: t.datasets.filter((id) => validDatasetIds.has(id)) } : {}),
      ...(t.inferred ? { inferred: true } : {}),
    }));
  const validTermIds = new Set(glossary.map((t) => t.id));

  // Drop parent refs / dataset-glossary refs that don't resolve.
  for (const t of glossary) {
    if (t.parent && !validTermIds.has(t.parent)) {
      delete (t as { parent?: string }).parent;
    }
  }
  for (const d of datasets) {
    if (d.glossaryTerms) {
      d.glossaryTerms = d.glossaryTerms.filter((id) => validTermIds.has(id));
      if (d.glossaryTerms.length === 0) delete (d as { glossaryTerms?: string[] }).glossaryTerms;
    }
  }

  const lineageNodeIds = new Set<string>();
  const lineageNodes = raw.lineageNodes
    .filter((n) => {
      if (lineageNodeIds.has(n.id)) return false;
      lineageNodeIds.add(n.id);
      return true;
    })
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      ...(n.datasetId && validDatasetIds.has(n.datasetId) ? { datasetId: n.datasetId } : {}),
      ...(n.technology ? { technology: n.technology } : {}),
      ...(n.description ? { description: n.description } : {}),
      ...(n.inferred ? { inferred: true } : {}),
    }));
  const validNodeIds = new Set(lineageNodes.map((n) => n.id));

  const lineageEdgeIds = new Set<string>();
  const lineageEdges = raw.lineageEdges
    .filter((e) => validNodeIds.has(e.source) && validNodeIds.has(e.target))
    .filter((e) => {
      if (lineageEdgeIds.has(e.id)) return false;
      lineageEdgeIds.add(e.id);
      return true;
    })
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.kind ? { kind: e.kind } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.inferred ? { inferred: true } : {}),
    }));

  // Contracts only for datasets that exist.
  const seenContractDsIds = new Set<string>();
  const contracts = raw.contracts
    .filter((c) => validDatasetIds.has(c.datasetId))
    .filter((c) => {
      if (seenContractDsIds.has(c.datasetId)) return false;
      seenContractDsIds.add(c.datasetId);
      return true;
    })
    .map((c) => ({
      datasetId: c.datasetId,
      ...(c.version ? { version: c.version } : {}),
      ...(c.purpose ? { purpose: c.purpose } : {}),
      ...(c.qualityRules && c.qualityRules.length > 0 ? { qualityRules: c.qualityRules } : {}),
      ...(c.terms && c.terms.length > 0
        ? { terms: c.terms.map((t) => ({ term: t.term, commitment: t.commitment })) }
        : {}),
      ...(c.inferred ? { inferred: true } : {}),
    }));

  return {
    title: raw.title,
    ...(raw.summary ? { summary: raw.summary } : {}),
    kind: raw.kind,
    datasets,
    glossary,
    lineageNodes,
    lineageEdges,
    contracts,
  };
}

export async function generateDataCatalog(ctx: GenerateContext): Promise<Result> {
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE("Data catalog")], ctx.sourceTools);
  const raw = getTextFromContent(result[result.length - 1].content);
  if (!raw?.trim()) throw new Error("Could not generate data-catalog draft");

  const parsed = await ctx.client.parse(
    ctx.model,
    DATA_CATALOG_PARSE_INSTRUCTIONS,
    raw,
    dataCatalogSchema,
    "data_catalog",
  );
  if (!parsed?.datasets) throw new Error("Invalid data-catalog structure");

  const dataCatalog = normaliseDataCatalog(parsed);
  // A catalog with no datasets AND no glossary AND no lineage is empty.
  if (dataCatalog.datasets.length === 0 && dataCatalog.glossary.length === 0 && dataCatalog.lineageNodes.length === 0) {
    throw new Error("Invalid data-catalog structure");
  }

  return { content: raw, dataCatalog };
}

// ── Report / default text ──────────────────────────────────────────────

export async function generateText(ctx: GenerateContext, label: string): Promise<Result> {
  const result = await run(ctx.client, ctx.model, ctx.instructions, [USER_MESSAGE(label)], ctx.sourceTools);
  const content = getTextFromContent(result[result.length - 1].content);
  if (!content?.trim()) throw new Error("Could not generate output");
  return { content };
}
