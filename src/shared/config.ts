import { Client } from "./lib/client";
import type { MCP, Model } from "./types/chat";

interface BackgroundConfig {
  url: string;
}

interface BackgroundPackConfig {
  [packName: string]: BackgroundConfig[];
}

interface SupportConfig {
  url?: string;
  email?: string;
}

interface ToolConfig {
  id: string;
  url?: string;
  name: string;
  description: string;
  icon?: string;
}

interface ModelConfig {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  effort?: "none" | "minimal" | "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
  verbosity?: "low" | "medium" | "high";
  compactThreshold?: number;
  tools?: {
    enabled: string[];
    disabled: string[];
  };
}

interface TTSConfig {
  model?: string;
  voices?: Record<string, string>;
}

interface STTConfig {
  model?: string;
}

interface NotebookStyleBase {
  name: string;
  /**
   * Either inline prompt text, or a URL (absolute `https://…` or
   * page-relative `/notebook/…`) fetched on demand and cached.
   * Use a URL for long templates so they don't bloat `config.json`.
   */
  prompt: string;
}

interface NotebookSlide extends NotebookStyleBase {}
interface NotebookPodcast extends NotebookStyleBase {
  voices?: string[];
}
interface NotebookReport extends NotebookStyleBase {}
interface NotebookInfographic extends NotebookStyleBase {}
interface NotebookProcess extends NotebookStyleBase {}
interface NotebookArchitecture extends NotebookStyleBase {}

interface NotebookConfig {
  model?: string;
  renderer?: string;
  slides?: NotebookSlide[];
  podcasts?: NotebookPodcast[];
  reports?: NotebookReport[];
  infographics?: NotebookInfographic[];
  processes?: NotebookProcess[];
  architectures?: NotebookArchitecture[];
}

interface VoiceConfig {
  enabled?: boolean;
  model?: string;
  transcriber?: string;
}

interface TextConfig {
  files: string[];
}

interface VisionConfig {
  files: string[];
}

interface RendererConfig {
  model?: string;
  disclaimer?: string;
  elicitation?: boolean;
}

interface InternetConfig {
  scraper?: string;
  searcher?: string;
  researcher?: string;
  elicitation?: boolean;
}

interface ExtractorConfig {
  model?: string;
  files: string[];
}

interface RepositoryConfig {
  embedder?: string;
  extractor?: string;
}

interface TranslatorConfig {
  model?: string;
  files: string[];
  languages: string[];
}

export interface CategoryConfig {
  name: string;
  description: string;
  consent?: boolean | string;
  /** Minimum classifier confidence (0..1) for this category to count as a match. Falls back to chat.classification.threshold. */
  threshold?: number;
}

export type RiskSeverity = "low" | "medium" | "high";

export interface RiskConfig {
  name: string;
  description: string;
  /** Visual emphasis on the warning banner. Defaults to "medium". */
  severity?: RiskSeverity;
  /** Body text shown in the warning. Falls back to a generic message using the risk name. */
  message?: string;
  /** Minimum classifier confidence (0..1) for this risk to fire. Falls back to chat.classification.threshold. */
  threshold?: number;
}

export interface ClassificationConfig {
  /** Override the model used for classification (defaults to chat.summarizer or the current chat model). */
  model?: string;
  /** Default threshold (0..1) applied when a category or risk does not set its own. */
  threshold?: number;
}

export function categorySlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

export const riskSlug = categorySlug;

interface ChatConfig {
  retentionDays?: number;
  optimizer?: string;
  summarizer?: string;
  classification?: ClassificationConfig;
  categories?: CategoryConfig[];
  risks?: RiskConfig[];
}

export interface DriveConfig {
  id: string;
  name: string;
  icon?: string;
}

interface BridgeConfig {
  url?: string;
}

interface TelemetryConfig {
  debug?: boolean;
}

interface ConfigSchema {
  title: string;
  disclaimer: string;
  bridge?: BridgeConfig;
  support?: SupportConfig;

  tools: ToolConfig[];
  models: ModelConfig[];

  drives?: DriveConfig[];

  backgrounds?: BackgroundPackConfig;

  tts?: TTSConfig;
  stt?: STTConfig;

  notebook?: NotebookConfig;

  voice?: VoiceConfig;
  vision?: VisionConfig;

  text?: TextConfig;

  internet?: InternetConfig;

  renderer?: RendererConfig;
  extractor?: ExtractorConfig;

  memory?: object;

  artifacts?: object;
  repository?: RepositoryConfig;
  translator?: TranslatorConfig;

  chat?: ChatConfig;
  telemetry?: TelemetryConfig;
}

const DEFAULT_TTS_VOICES: Record<string, string> = {
  host: "nova",
  analyst: "onyx",
  narrator: "alloy",
  storyteller: "fable",
  skeptic: "echo",
};

const DEFAULT_VISION_FILES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const DEFAULT_TRANSLATOR_LANGUAGES = ["en", "de", "fr", "it", "es"];

interface Config {
  title: string;
  disclaimer: string;
  bridge: BridgeConfig | null;
  support: SupportConfig | null;

  client: Client;

  mcps: MCP[];
  models: Model[];

  drives: DriveConfig[];

  tts: TTSConfig | null;
  stt: STTConfig | null;

  notebook: NotebookConfig | null;

  voice: VoiceConfig | null;
  vision: VisionConfig | null;

  text: TextConfig | null;
  extractor: ExtractorConfig | null;

  internet: InternetConfig | null;

  renderer: RendererConfig | null;

  memory: object | null;

  artifacts: object | null;
  repository: RepositoryConfig | null;
  translator: TranslatorConfig | null;

  chat: ChatConfig | null;

  telemetry: boolean;
  telemetryDebug: boolean;

  backgrounds: BackgroundPackConfig;
}

let config: Config;

export const loadConfig = async (): Promise<Config | undefined> => {
  try {
    const resp = await fetch("/config.json");

    if (!resp.ok) {
      throw new Error(`failed to load config.json: ${resp.statusText}`);
    }

    const cfg: ConfigSchema = await resp.json();

    config = {
      title: cfg.title,
      disclaimer: cfg.disclaimer,
      bridge: cfg.bridge ?? null,
      support: cfg.support ?? null,

      client: new Client(),

      // Relative MCPs (no explicit url) are proxied through `/api/v1/mcp/{id}`
      // and gated by backend RBAC. They are resolved to their proxy url here;
      // availability filtering against `/v1/mcp` happens at runtime in ToolsProvider.
      mcps:
        cfg.tools?.map((mcp) => ({
          ...mcp,
          url: mcp.url ?? new URL(`/api/v1/mcp/${mcp.id}`, window.location.origin).toString(),
        })) ?? [],

      models: cfg.models ?? [],

      drives: cfg.drives ?? [],

      tts: cfg.tts ? { model: cfg.tts.model, voices: cfg.tts.voices ?? DEFAULT_TTS_VOICES } : null,
      stt: cfg.stt ?? null,

      notebook: cfg.notebook ?? null,

      voice:
        cfg.voice && cfg.voice.enabled !== false
          ? { model: cfg.voice.model, transcriber: cfg.voice.transcriber }
          : null,
      vision: cfg.vision ? { files: cfg.vision.files ?? DEFAULT_VISION_FILES } : null,

      text: cfg.text ? { files: cfg.text.files } : null,

      extractor: cfg.extractor ? { model: cfg.extractor.model, files: cfg.extractor.files ?? [] } : null,

      internet: cfg.internet ?? null,
      renderer: cfg.renderer ?? null,
      memory: cfg.memory ?? null,
      repository: cfg.repository ?? null,
      artifacts: cfg.artifacts ?? null,

      translator: cfg.translator
        ? {
            model: cfg.translator.model,
            files: cfg.translator.files ?? [],
            languages: cfg.translator.languages ?? DEFAULT_TRANSLATOR_LANGUAGES,
          }
        : null,

      chat: cfg.chat ?? null,

      telemetry: cfg.telemetry != null,
      telemetryDebug: cfg.telemetry?.debug === true,

      backgrounds: cfg.backgrounds ?? {},
    };

    return config;
  } catch (error) {
    console.error("unable to load config", error);
  }
};

export const getConfig = (): Config => {
  if (!config) {
    throw new Error("config not loaded");
  }

  return config;
};
