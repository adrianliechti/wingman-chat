/**
 * Output styles and instruction templates for the notebook studio.
 *
 * Studio instruction templates and slide-common rules are bundled here
 * via `?raw` imports. Per-type style prompts come from the server's notebook
 * inventory (`notebooks.ts`, served by `GET /notebooks`) and are fetched on
 * demand (see `resolvePrompt`). User-supplied styles from `config.notebook.*`
 * override the built-ins and can be inline strings or URLs the same way.
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
import { notebookStyles } from "./notebooks";

// ── Public prompt exports ──────────────────────────────────────────────

export { chatInstructions };

// ── Style registry ─────────────────────────────────────────────────────

export interface Style {
  id: string;
  label: string;
  /**
   * Either inline prompt text, or a URL fetched lazily and cached.
   * URLs are detected by an `http(s)://` prefix or a leading `/`
   * (e.g. `/notebooks/<type>/<id>.md` served by the inventory endpoint).
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
  /** All styles available for this type (config overrides, else inventory built-ins). */
  getAll(): Style[];
  /** Resolve a style by id, falling back to the first available; undefined if none exist. */
  get(id?: string): Style | undefined;
}

type NotebookStyleType = "slides" | "podcasts" | "reports" | "processes" | "architectures" | "infographics";

/**
 * Registry for one output type. Built-in styles come from the server notebook
 * inventory (`notebooks.ts`, loaded at startup); a matching `config.notebook.<type>`
 * array, when present, overrides them. Resolution is lazy because both sources are
 * populated after this module is first evaluated.
 */
function styleRegistry(type: NotebookStyleType): StyleRegistry {
  const resolve = (): Style[] => {
    const overrides = getConfig().notebook?.[type] as { name: string; prompt: string; voices?: string[] }[] | undefined;

    if (overrides && overrides.length > 0) {
      return overrides.map((s) => ({ id: toId(s.name), label: s.name, prompt: s.prompt, voices: s.voices }));
    }

    return notebookStyles(type);
  };

  return {
    getAll: resolve,
    get: (id) => {
      const all = resolve();
      return all.find((s) => s.id === id) ?? all[0];
    },
  };
}

const toId = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

export const slideStyles = styleRegistry("slides");
export const podcastStyles = styleRegistry("podcasts");
export const reportStyles = styleRegistry("reports");
export const processStyles = styleRegistry("processes");
export const architectureStyles = styleRegistry("architectures");
export const infographicStyles = styleRegistry("infographics");

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
    if (style) {
      prompt += `\n\n${await resolvePrompt(style.prompt)}\n`;
    }
  } else {
    const meta = OUTPUT_META[type];
    prompt = isOnePager ? studioSlideOnePagerInstructions : meta.template;

    if (type === "slides") {
      prompt = prompt.replace("{{COMMON_RULES}}", slideCommonRules);
    }

    if (meta.styles) {
      // `get` can return undefined only when the notebook inventory is empty
      // (e.g. a missing/empty notebook dir); fall back to no style section.
      const style = meta.styles.get(styleId ?? meta.defaultStyleId);
      const styleText = style ? await resolvePrompt(style.prompt) : "";
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
  const styleText = style ? await resolvePrompt(style.prompt) : "";

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
