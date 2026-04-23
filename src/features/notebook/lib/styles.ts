/**
 * Output styles and instruction templates for the notebook studio.
 *
 * This module owns all of the prompt text (slide/podcast/report/infographic
 * style prompts + the studio instruction templates) and exposes:
 *   - per-type style registries (user config can override defaults)
 *   - `OUTPUT_META` — title + template + default style per output type
 *   - `buildInstructions(type, styleId)` — assembles the final system prompt
 */

import { getConfig } from "@/shared/config";
import chatInstructions from "../prompts/chat.txt?raw";
import infographicStyleAnime from "../prompts/infographic-style-anime.txt?raw";
import infographicStyleAuto from "../prompts/infographic-style-auto.txt?raw";
import infographicStyleBento from "../prompts/infographic-style-bento.txt?raw";
import infographicStyleBricks from "../prompts/infographic-style-bricks.txt?raw";
import infographicStyleClay from "../prompts/infographic-style-clay.txt?raw";
import infographicStyleEditorial from "../prompts/infographic-style-editorial.txt?raw";
import infographicStyleInstructional from "../prompts/infographic-style-instructional.txt?raw";
import infographicStyleKawaii from "../prompts/infographic-style-kawaii.txt?raw";
import infographicStyleProfessional from "../prompts/infographic-style-professional.txt?raw";
import infographicStyleScientific from "../prompts/infographic-style-scientific.txt?raw";
import infographicStyleSketchNote from "../prompts/infographic-style-sketch-note.txt?raw";
import podcastStyleBriefing from "../prompts/podcast-style-briefing.txt?raw";
import podcastStyleDebate from "../prompts/podcast-style-debate.txt?raw";
import podcastStyleDeepDive from "../prompts/podcast-style-deep-dive.txt?raw";
import podcastStyleOverview from "../prompts/podcast-style-overview.txt?raw";
import podcastStyleStory from "../prompts/podcast-style-story.txt?raw";
import reportStyleDashboard from "../prompts/report-style-dashboard.txt?raw";
import reportStyleExecutive from "../prompts/report-style-executive.txt?raw";
import reportStyleMagazine from "../prompts/report-style-magazine.txt?raw";
import reportStyleResearch from "../prompts/report-style-research.txt?raw";
import slideCommonRules from "../prompts/slide-style-common.txt?raw";
import slideStyleConsulting from "../prompts/slide-style-consulting.txt?raw";
import slideStyleDark from "../prompts/slide-style-dark.txt?raw";
import slideStyleNature from "../prompts/slide-style-nature.txt?raw";
import slideStyleSwiss from "../prompts/slide-style-swiss.txt?raw";
import slideStyleWhiteboard from "../prompts/slide-style-whiteboard.txt?raw";
import studioAudioInstructions from "../prompts/studio-audio-overview.txt?raw";
import studioInfographicInstructions from "../prompts/studio-infographic.txt?raw";
import studioMindMapInstructions from "../prompts/studio-mind-map.txt?raw";
import studioQuizInstructions from "../prompts/studio-quiz.txt?raw";
import studioReportInstructions from "../prompts/studio-report.txt?raw";
import studioSlideInstructions from "../prompts/studio-slide-deck.txt?raw";
import studioSlideImageInstructions from "../prompts/studio-slide-images.txt?raw";
import type { OutputType } from "../types/notebook";

// ── Public prompt exports ──────────────────────────────────────────────

export { chatInstructions };

// ── Style registry ─────────────────────────────────────────────────────

export interface Style {
  id: string;
  label: string;
  prompt: string;
  voices?: string[];
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

export const slideStyles: StyleRegistry = makeRegistry(
  [
    { id: "whiteboard", label: "Whiteboard", prompt: slideStyleWhiteboard },
    { id: "consulting", label: "Consulting", prompt: slideStyleConsulting },
    { id: "dark", label: "Dark", prompt: slideStyleDark },
    { id: "swiss", label: "Swiss", prompt: slideStyleSwiss },
    { id: "nature", label: "Nature", prompt: slideStyleNature },
  ],
  () => getConfig().canvas?.slides?.map((s) => ({ id: toId(s.name), label: s.name, prompt: s.prompt })),
);

export const podcastStyles: StyleRegistry = makeRegistry(
  [
    { id: "overview", label: "Overview", prompt: podcastStyleOverview, voices: ["host"] },
    { id: "deep-dive", label: "Deep Dive", prompt: podcastStyleDeepDive, voices: ["analyst"] },
    { id: "briefing", label: "Briefing", prompt: podcastStyleBriefing, voices: ["narrator"] },
    { id: "story", label: "Story", prompt: podcastStyleStory, voices: ["storyteller"] },
    { id: "debate", label: "Debate", prompt: podcastStyleDebate, voices: ["host", "skeptic"] },
  ],
  () =>
    getConfig().canvas?.podcasts?.map((p) => ({
      id: toId(p.name),
      label: p.name,
      prompt: p.prompt,
      voices: p.voices ?? ["host"],
    })),
);

export const reportStyles: StyleRegistry = makeRegistry(
  [
    { id: "executive", label: "Executive", prompt: reportStyleExecutive },
    { id: "dashboard", label: "Dashboard", prompt: reportStyleDashboard },
    { id: "research", label: "Research", prompt: reportStyleResearch },
    { id: "magazine", label: "Magazine", prompt: reportStyleMagazine },
  ],
  () => getConfig().canvas?.reports?.map((r) => ({ id: toId(r.name), label: r.name, prompt: r.prompt })),
);

export const infographicStyles: StyleRegistry = makeRegistry(
  [
    { id: "auto", label: "Auto-select", prompt: infographicStyleAuto },
    { id: "sketch-note", label: "Sketch Note", prompt: infographicStyleSketchNote },
    { id: "kawaii", label: "Kawaii", prompt: infographicStyleKawaii },
    { id: "professional", label: "Professional", prompt: infographicStyleProfessional },
    { id: "scientific", label: "Scientific", prompt: infographicStyleScientific },
    { id: "anime", label: "Anime", prompt: infographicStyleAnime },
    { id: "clay", label: "Clay", prompt: infographicStyleClay },
    { id: "editorial", label: "Editorial", prompt: infographicStyleEditorial },
    { id: "instructional", label: "Instructional", prompt: infographicStyleInstructional },
    { id: "bento", label: "Bento Grid", prompt: infographicStyleBento },
    { id: "bricks", label: "Bricks", prompt: infographicStyleBricks },
  ],
  () => getConfig().canvas?.infographics?.map((i) => ({ id: toId(i.name), label: i.name, prompt: i.prompt })),
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
};

// ── Instruction assembly ───────────────────────────────────────────────

/**
 * Assemble the final system prompt for an output generation.
 *
 * Slide generation has two modes controlled by `config.notebook?.mode`:
 *   - `"images"` → uses a dedicated image-mode template (no style substitution;
 *      consistency is achieved via the per-deck style-reference image)
 *   - otherwise → HTML slides template + `{{COMMON_RULES}}` + `{{STYLE_SECTION}}`
 *
 * All other output types substitute `{{STYLE_SECTION}}` when a style registry
 * is registered for them.
 */
export function buildInstructions(type: OutputType, styleId?: string): string {
  if (type === "slides" && getConfig().notebook?.mode === "images") {
    return studioSlideImageInstructions;
  }

  const meta = OUTPUT_META[type];
  let prompt = meta.template;

  if (type === "slides") {
    prompt = prompt.replace("{{COMMON_RULES}}", slideCommonRules);
  }

  if (meta.styles) {
    const style = meta.styles.get(styleId ?? meta.defaultStyleId);
    prompt = prompt.replace("{{STYLE_SECTION}}", style.prompt);
  }

  return prompt;
}
