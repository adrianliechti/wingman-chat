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
  prompts?: string[];
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

interface WorkflowConfig {
  model?: string;
}

interface VoiceConfig {
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

interface BridgeConfig {
  url?: string;
}

interface ConfigSchema {
  title: string;
  disclaimer: string;
  bridge?: BridgeConfig;
  support?: SupportConfig;

  tools: ToolConfig[];
  models: ModelConfig[];

  backgrounds?: BackgroundPackConfig;

  tts?: TTSConfig;
  stt?: STTConfig;

  notebook?: NotebookConfig;
  workflow?: WorkflowConfig;

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

const DEFAULT_TEXT_FILES = [
  "text/csv",
  "text/markdown",
  "text/plain",
  "application/json",
  "application/sql",
  "application/toml",
  "application/x-yaml",
  "application/xml",
  "text/css",
  "text/html",
  "text/xml",
  "text/yaml",

  ".c",
  ".cpp",
  ".cs",
  ".go",
  ".html",
  ".java",
  ".js",
  ".kt",
  ".md",
  ".py",
  ".rs",
  ".ts",
];

const DEFAULT_EXTRACTOR_FILES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

  ".msg",
  ".eml",
];

const DEFAULT_TRANSLATOR_LANGUAGES = ["en", "de", "fr", "it", "es"];

interface Config {
  title: string;
  disclaimer: string;
  bridge: BridgeConfig | null;
  support: SupportConfig | null;

  client: Client;

  mcps: MCP[];
  models: Model[];

  tts: TTSConfig | null;
  stt: STTConfig | null;

  notebook: NotebookConfig | null;
  workflow: WorkflowConfig | null;

  voice: VoiceConfig | null;
  vision: VisionConfig | null;

  text: TextConfig;
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

      tts: cfg.tts ? { model: cfg.tts.model, voices: cfg.tts.voices ?? DEFAULT_TTS_VOICES } : null,
      stt: cfg.stt ?? null,

      notebook: cfg.notebook ?? null,
      workflow: cfg.workflow ?? null,

      voice: cfg.voice ?? null,
      vision: cfg.vision ? { files: cfg.vision.files ?? DEFAULT_VISION_FILES } : null,

      text: { files: cfg.text?.files ?? DEFAULT_TEXT_FILES },

      extractor: cfg.extractor
        ? { model: cfg.extractor.model, files: cfg.extractor.files ?? DEFAULT_EXTRACTOR_FILES }
        : null,

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
