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
  url: string;
  name: string;
  description: string;
  icon?: string;
}

interface ModelConfig {
  id: string;
  name: string;
  description?: string;
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

interface NotebookConfig {
  model?: string;
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

interface ChatConfig {
  retentionDays?: number;
  optimizer?: string;
  summarizer?: string;
}

interface DriveConfig {
  id: string;
  name: string;
  icon?: string;
}

interface BridgeConfig {
  url?: string;
}

interface CanvasSlideConfig {
  name: string;
  prompt: string;
}

interface CanvasPodcastConfig {
  name: string;
  prompt: string;
  voices?: string[];
}

interface CanvasReportConfig {
  name: string;
  prompt: string;
}

interface CanvasInfographicConfig {
  name: string;
  prompt: string;
}

interface CanvasConfig {
  slides?: CanvasSlideConfig[];
  podcasts?: CanvasPodcastConfig[];
  reports?: CanvasReportConfig[];
  infographics?: CanvasInfographicConfig[];
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

  canvas?: CanvasConfig;

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
  telemetry?: object;
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

  backgrounds: BackgroundPackConfig;

  canvas: CanvasConfig;
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

      backgrounds: cfg.backgrounds ?? {},

      canvas: cfg.canvas ?? {},
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
