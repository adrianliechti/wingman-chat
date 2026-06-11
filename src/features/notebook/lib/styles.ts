/**
 * Output styles and instruction templates for the notebook studio.
 *
 * Studio instruction templates and slide-common rules are bundled here
 * via `?raw` imports. Per-type style prompts live as separate `.md`
 * files under `public/notebook/<type>/<id>.md` and are fetched on demand
 * (see `resolvePrompt`). User-supplied styles from `config.notebook.*`
 * can be either inline strings or URLs using the same mechanism.
 *
 * Exposes:
 *   - per-type style registries (`config.notebook.*` overrides defaults)
 *   - `OUTPUT_META` — title + template + default style per output type
 *   - `buildInstructions(type, styleId)` — assembles the final system prompt
 */

import { getConfig } from "@/shared/config";
import chatInstructions from "../prompts/chat.txt?raw";
import slideCommonRules from "../prompts/slide-style-common.txt?raw";
import studioArchitectureInstructions from "../prompts/studio-architecture.txt?raw";
import studioAudioInstructions from "../prompts/studio-audio-overview.txt?raw";
import studioDataCatalogInstructions from "../prompts/studio-data-catalog.txt?raw";
import studioInfographicInstructions from "../prompts/studio-infographic.txt?raw";
import studioMindMapInstructions from "../prompts/studio-mind-map.txt?raw";
import studioProcessInstructions from "../prompts/studio-process.txt?raw";
import studioQuizInstructions from "../prompts/studio-quiz.txt?raw";
import studioReportInstructions from "../prompts/studio-report.txt?raw";
import studioSlideInstructions from "../prompts/studio-slide-deck.txt?raw";
import studioSlideImageInstructions from "../prompts/studio-slide-images.txt?raw";
import studioSlideOnePagerInstructions from "../prompts/studio-slide-one-pager.txt?raw";
import studioSlidePlannerInstructions from "../prompts/studio-slide-planner.txt?raw";
import studioSlideWriterInstructions from "../prompts/studio-slide-writer.txt?raw";
import type { OutputType } from "../types/notebook";

// ── Public prompt exports ──────────────────────────────────────────────

export { chatInstructions };

// ── Style registry ─────────────────────────────────────────────────────

export interface Style {
  id: string;
  label: string;
  /**
   * Either inline prompt text, or a URL fetched lazily and cached.
   * URLs are detected by an `http(s)://` prefix or a leading `/`
   * (page-absolute path served from `public/`).
   */
  prompt: string;
  description?: string;
  voices?: string[];
}

// ── Lazy prompt loading from URL ──────────────────────────────────────

const promptCache = new Map<string, Promise<string>>();

/**
 * Resolve a prompt value — if it looks like a URL (`http(s)://…` or a
 * page-absolute `/…` path served from `public/`), fetch and cache it.
 * Anything else is treated as inline text and returned as-is.
 */
async function resolvePrompt(value: string): Promise<string> {
  if (!value) return "";
  if (!/^(https?:\/\/|\/)/.test(value)) return value;

  const cached = promptCache.get(value);
  if (cached) return cached;

  const promise = fetch(value).then((resp) => {
    if (!resp.ok) throw new Error(`failed to fetch prompt from ${value}: ${resp.status} ${resp.statusText}`);
    return resp.text();
  });
  // Drop failed entries so a later attempt can fire a new request.
  promise.catch(() => promptCache.delete(value));
  promptCache.set(value, promise);
  return promise;
}

export interface StyleRegistry {
  /** All styles available for this type (defaults or config overrides). */
  getAll(): Style[];
  /** Resolve a style by id, falling back to the first available. */
  get(id?: string): Style;
}

function makeRegistry(defaults: Style[], override: () => Style[] | undefined): StyleRegistry {
  const resolve = (): Style[] => {
    const o = override();
    return o && o.length > 0 ? o : defaults;
  };
  return {
    getAll: resolve,
    get: (id) => {
      const all = resolve();
      return all.find((s) => s.id === id) ?? all[0] ?? defaults[0];
    },
  };
}

const toId = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

// ── Registries ─────────────────────────────────────────────────────────

// Default-style prompts live under `public/notebook/<type>/<id>.md` and are
// fetched lazily via the URL-aware `resolvePrompt`. User-supplied prompts
// from `config.notebook.*` can be either inline strings or URLs the same way.

export const slideStyles: StyleRegistry = makeRegistry(
  [
    {
      id: "whiteboard",
      label: "Whiteboard",
      description: "Clean minimal design with hand-drawn feel and open whitespace",
      prompt: "/notebook/slides/whiteboard.md",
    },
    {
      id: "consulting",
      label: "Consulting",
      description: "Professional business style with structured layouts and accent colors",
      prompt: "/notebook/slides/consulting.md",
    },
    {
      id: "dark",
      label: "Dark",
      description: "Bold dark backgrounds with high-contrast text and vibrant highlights",
      prompt: "/notebook/slides/dark.md",
    },
    {
      id: "swiss",
      label: "Swiss",
      description: "Grid-based typography-first design inspired by Swiss graphic style",
      prompt: "/notebook/slides/swiss.md",
    },
    {
      id: "nature",
      label: "Nature",
      description: "Warm earthy tones with organic shapes and natural imagery",
      prompt: "/notebook/slides/nature.md",
    },
  ],
  () => getConfig().notebook?.slides?.map((s) => ({ id: toId(s.name), label: s.name, prompt: s.prompt })),
);

export const podcastStyles: StyleRegistry = makeRegistry(
  [
    {
      id: "overview",
      label: "Overview",
      description: "A single-host overview of the key points and main takeaways",
      prompt: "/notebook/podcasts/overview.md",
      voices: ["host"],
    },
    {
      id: "deep-dive",
      label: "Deep Dive",
      description: "An in-depth exploration of the topic with detailed analysis",
      prompt: "/notebook/podcasts/deep-dive.md",
      voices: ["analyst"],
    },
    {
      id: "briefing",
      label: "Briefing",
      description: "A concise narrated briefing of the essential facts",
      prompt: "/notebook/podcasts/briefing.md",
      voices: ["narrator"],
    },
    {
      id: "story",
      label: "Story",
      description: "A narrative retelling that weaves sources into a compelling story",
      prompt: "/notebook/podcasts/story.md",
      voices: ["storyteller"],
    },
    {
      id: "debate",
      label: "Debate",
      description: "A two-host debate examining different perspectives",
      prompt: "/notebook/podcasts/debate.md",
      voices: ["host", "skeptic"],
    },
  ],
  () =>
    getConfig().notebook?.podcasts?.map((p) => ({
      id: toId(p.name),
      label: p.name,
      prompt: p.prompt,
      voices: p.voices ?? ["host"],
    })),
);

export const reportStyles: StyleRegistry = makeRegistry(
  [
    {
      id: "executive",
      label: "Executive",
      description: "A polished summary with key findings and recommendations",
      prompt: "/notebook/reports/executive.md",
    },
    {
      id: "dashboard",
      label: "Dashboard",
      description: "A data-focused report with metrics and visual indicators",
      prompt: "/notebook/reports/dashboard.md",
    },
    {
      id: "research",
      label: "Research",
      description: "An academic-style analysis with methodology and citations",
      prompt: "/notebook/reports/research.md",
    },
    {
      id: "magazine",
      label: "Magazine",
      description: "An editorial-style article designed for broad audiences",
      prompt: "/notebook/reports/magazine.md",
    },
  ],
  () => getConfig().notebook?.reports?.map((r) => ({ id: toId(r.name), label: r.name, prompt: r.prompt })),
);

export const processStyles: StyleRegistry = makeRegistry(
  [
    {
      id: "bpmn",
      label: "BPMN 2.0",
      description: "Standard banking / insurance notation — pools, lanes, gateways, events",
      prompt: "/notebook/processes/bpmn.md",
    },
    {
      id: "swimlane",
      label: "Swimlane",
      description: "Role-based flowchart that makes cross-team hand-offs explicit",
      prompt: "/notebook/processes/swimlane.md",
    },
    {
      id: "itil",
      label: "ITIL / ITSM",
      description: "Change, incident, problem, or request flows aligned with ITIL",
      prompt: "/notebook/processes/itil.md",
    },
    {
      id: "sdlc",
      label: "SDLC",
      description: "Requirements → design → build → release → operate, with SOX gates",
      prompt: "/notebook/processes/sdlc.md",
    },
    {
      id: "three-lines",
      label: "3 Lines of Defence",
      description: "Governance view — business / risk & compliance / internal audit",
      prompt: "/notebook/processes/three-lines.md",
    },
  ],
  () => getConfig().notebook?.processes?.map((p) => ({ id: toId(p.name), label: p.name, prompt: p.prompt })),
);

export const architectureStyles: StyleRegistry = makeRegistry(
  [
    {
      id: "c4",
      label: "C4 Model",
      description: "Context · Container · Component · Deployment — all four views, switchable as tabs",
      prompt: "/notebook/architectures/c4.md",
    },
    {
      id: "sequence",
      label: "Sequence",
      description: "UML sequence — actors and ordered messages for one flow",
      prompt: "/notebook/architectures/sequence.md",
    },
  ],
  () => getConfig().notebook?.architectures?.map((a) => ({ id: toId(a.name), label: a.name, prompt: a.prompt })),
);

export const infographicStyles: StyleRegistry = makeRegistry(
  [
    { id: "auto", label: "Auto-select", prompt: "/notebook/infographics/auto.md" },
    { id: "sketch-note", label: "Sketch Note", prompt: "/notebook/infographics/sketch-note.md" },
    { id: "kawaii", label: "Kawaii", prompt: "/notebook/infographics/kawaii.md" },
    { id: "professional", label: "Professional", prompt: "/notebook/infographics/professional.md" },
    { id: "scientific", label: "Scientific", prompt: "/notebook/infographics/scientific.md" },
    { id: "anime", label: "Anime", prompt: "/notebook/infographics/anime.md" },
    { id: "clay", label: "Clay", prompt: "/notebook/infographics/clay.md" },
    { id: "editorial", label: "Editorial", prompt: "/notebook/infographics/editorial.md" },
    { id: "instructional", label: "Instructional", prompt: "/notebook/infographics/instructional.md" },
    { id: "bento", label: "Bento Grid", prompt: "/notebook/infographics/bento.md" },
    { id: "bricks", label: "Bricks", prompt: "/notebook/infographics/bricks.md" },
  ],
  () => getConfig().notebook?.infographics?.map((i) => ({ id: toId(i.name), label: i.name, prompt: i.prompt })),
);

// ── Output metadata ────────────────────────────────────────────────────

export interface OutputMeta {
  title: string;
  template: string;
  /** Style registry if this type supports user-pickable styles. */
  styles?: StyleRegistry;
  /** Fallback style id when none is supplied. */
  defaultStyleId?: string;
}

export const OUTPUT_META: Record<OutputType, OutputMeta> = {
  podcast: {
    title: "Podcast",
    template: studioAudioInstructions,
    styles: podcastStyles,
    defaultStyleId: "overview",
  },
  slides: {
    title: "Slides",
    template: studioSlideInstructions,
    styles: slideStyles,
    defaultStyleId: "whiteboard",
  },
  infographic: {
    title: "Infographic",
    template: studioInfographicInstructions,
    styles: infographicStyles,
    defaultStyleId: "auto",
  },
  report: {
    title: "Report",
    template: studioReportInstructions,
    styles: reportStyles,
    defaultStyleId: "executive",
  },
  quiz: { title: "Quiz", template: studioQuizInstructions },
  mindmap: { title: "Mind Map", template: studioMindMapInstructions },
  process: {
    title: "Process",
    template: studioProcessInstructions,
    styles: processStyles,
    defaultStyleId: "bpmn",
  },
  architecture: {
    title: "Architecture",
    template: studioArchitectureInstructions,
    styles: architectureStyles,
    defaultStyleId: "c4",
  },
  "data-catalog": {
    title: "Data Catalog",
    template: studioDataCatalogInstructions,
    // No style picker — the catalog generation populates all four sections
    // (inventory / glossary / lineage / contracts) in a single pass.
  },
};

// ── Instruction assembly ───────────────────────────────────────────────

export interface BuildInstructionsOptions {
  /** Target language for the generated output (e.g. "English", "German"). */
  language?: string;
  /** Requested slide count for slide decks. Overrides the default 8–12 range. */
  slideCount?: number;
  /** Free-form user instructions appended to the prompt (e.g. audience, focus, tone). */
  instructions?: string;
  /** Slide generation mode: "html" for editable/structured, "images" for AI-generated visuals. */
  slideMode?: "html" | "images";
}

/**
 * Assemble the final system prompt for an output generation.
 *
 * Slide generation has two modes controlled by `options.slideMode`:
 *   - `"images"` → uses a dedicated image-mode template (no style substitution;
 *      consistency is achieved via the per-deck style-reference image)
 *   - otherwise → HTML slides template + `{{COMMON_RULES}}` + `{{STYLE_SECTION}}`
 *
 * All other output types substitute `{{STYLE_SECTION}}` when a style registry
 * is registered for them.
 *
 * Optional `language` and `slideCount` directives are appended as a trailing
 * override block so they take precedence over any defaults baked into the
 * template prompts.
 */
export async function buildInstructions(
  type: OutputType,
  styleId?: string,
  options?: BuildInstructionsOptions,
): Promise<string> {
  let prompt: string;
  const isOnePager = type === "slides" && options?.slideCount === 1 && options?.slideMode !== "images";

  if (type === "slides" && options?.slideMode === "images") {
    prompt = studioSlideImageInstructions;

    const style = slideStyles.get(styleId ?? OUTPUT_META.slides.defaultStyleId);
    const styleText = await resolvePrompt(style.prompt);
    prompt += `\n\n${styleText}\n`;
  } else {
    const meta = OUTPUT_META[type];
    prompt = isOnePager ? studioSlideOnePagerInstructions : meta.template;

    if (type === "slides") {
      prompt = prompt.replace("{{COMMON_RULES}}", slideCommonRules);
    }

    if (meta.styles) {
      const style = meta.styles.get(styleId ?? meta.defaultStyleId);
      const styleText = await resolvePrompt(style.prompt);
      prompt = prompt.replace("{{STYLE_SECTION}}", styleText);
    }
  }

  return prompt + buildOverridesBlock(options, { slideCount: type === "slides" && !isOnePager });
}

/** Render the trailing "User overrides" block shared by all prompt builders. */
function buildOverridesBlock(
  options: BuildInstructionsOptions | undefined,
  include: { slideCount?: boolean } = {},
): string {
  const overrides: string[] = [];
  if (options?.language) {
    overrides.push(
      `- Write **all output text in ${options.language}** (titles, body copy, labels, captions, speaker lines). This overrides any language used in the source material.`,
    );
  }
  if (include.slideCount && options?.slideCount && options.slideCount > 0) {
    const n = Math.round(options.slideCount);
    overrides.push(
      `- Produce **exactly ${n} ${n === 1 ? "slide" : "slides"}**. This overrides any slide count mentioned elsewhere in the instructions (e.g. "8–12 slides"). Plan the deck arc to fit this exact length.`,
    );
  }
  if (options?.instructions) {
    overrides.push(`- Additional user instructions: ${options.instructions}`);
  }

  if (overrides.length === 0) return "";
  return `\n\n---\n\n## User overrides (highest priority)\n\n${overrides.join("\n")}\n`;
}

/**
 * System prompts for the two-phase HTML deck pipeline: one planner
 * conversation produces the spine + theme.css + per-slide briefs, then one
 * small writer conversation per slide implements its brief in parallel.
 * Both share the same style section; the writer additionally gets the
 * common layout rules it must obey when emitting HTML.
 */
export async function buildSlidePrompts(
  styleId?: string,
  options?: BuildInstructionsOptions,
): Promise<{ planner: string; writer: string }> {
  const style = slideStyles.get(styleId ?? OUTPUT_META.slides.defaultStyleId);
  const styleText = await resolvePrompt(style.prompt);

  // The planner owns deck-level overrides (slide count); writers inherit
  // language/user instructions so copy on every slide complies.
  const planner =
    studioSlidePlannerInstructions.replace("{{STYLE_SECTION}}", styleText) +
    buildOverridesBlock(options, { slideCount: true });
  const writer =
    studioSlideWriterInstructions
      .replace("{{COMMON_RULES}}", slideCommonRules)
      .replace("{{STYLE_SECTION}}", styleText) + buildOverridesBlock(options);

  return { planner, writer };
}
