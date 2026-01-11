import { Client } from "./lib/client";
import type { MCP, Model } from "./types/chat";

interface backgroundConfig {
  url: string;
}

interface backgroundPackConfig {
  [packName: string]: backgroundConfig[];
}

interface config {
  title: string;
  disclaimer: string;

  tools: toolConfig[];
  models: modelConfig[];

  backgrounds?: backgroundPackConfig;

  tts?: ttsConfig;
  stt?: sttConfig;

  workflow?: workflowConfig;
  recorder?: recorderConfig;

  voice?: voiceConfig;
  vision?: visionConfig;

  text?: textConfig;

  bridge?: bridgeConfig;
  internet?: internetConfig;

  renderer?: rendererConfig;
  extractor?: extractorConfig;
  interpreter?: interpreterConfig;

  artifacts?: artifactsConfig;
  repository?: repositoryConfig;
  translator?: translatorConfig;
  researcher?: researcherConfig;
}

interface modelConfig {
  id: string;

  name: string;
  description?: string;

  tools?: {
    enabled: string[];
    disabled: string[];
  };

  prompts?: string[];
}

interface toolConfig {
  id: string;

  url: string;

  name: string;
  description: string;
}

interface ttsConfig {
  model?: string;
}

interface sttConfig {
  model?: string;
}

type workflowConfig = object;

type recorderConfig = object;

interface voiceConfig {
  model?: string;
  transcriber?: string;
}

interface textConfig {
  files: string[];
}

interface visionConfig {
  files: string[];
}

interface rendererConfig {
  model?: string
  elicitation?: boolean;
}

interface bridgeConfig {
  url: string;
}

interface internetConfig {
  elicitation?: boolean;
}

type interpreterConfig = object;

interface extractorConfig {
  model?: string;
  files: string[];
}

interface repositoryConfig {
  embedder?: string;
  extractor?: string;

  context_pages?: number;
}

type artifactsConfig = object;

interface translatorConfig {
  model?: string
  files: string[];

  languages: string[];
}

interface researcherConfig {
  model?: string;
}

interface Config {
  title: string;
  disclaimer: string;

  client: Client;

  mcps: MCP[];
  models: Model[];

  tts: ttsConfig | null;
  stt: sttConfig | null;

  workflow: workflowConfig | null;
  recorder: recorderConfig | null;

  voice: voiceConfig | null;
  vision: visionConfig | null;

  text: textConfig | null;
  extractor: extractorConfig | null;

  bridge: bridgeConfig | null;
  internet: internetConfig | null;

  renderer: rendererConfig | null;
  interpreter: interpreterConfig | null;

  artifacts: artifactsConfig | null;
  repository: repositoryConfig | null;
  translator: translatorConfig | null;
  researcher: researcherConfig | null;

  backgrounds: backgroundPackConfig;
}

let config: Config;

export const loadConfig = async (): Promise<Config | undefined> => {
  try {
    const resp = await fetch("/config.json");

    if (!resp.ok) {
      throw new Error(`failed to load config.json: ${resp.statusText}`);
    }

    const cfg: config = await resp.json();

    const client = new Client();

    config = {
      title: cfg.title,
      disclaimer: cfg.disclaimer,

      client: client,

      mcps: cfg.tools?.map((mcp) => {
        return {
          id: mcp.id,

          name: mcp.name,
          description: mcp.description,

          url: mcp.url ?? new URL(`/api/v1/mcp/${mcp.id}`, window.location.origin).toString(),
        };
      }) ?? [],

      models: cfg.models?.map((model) => {
        return {
          id: model.id,

          name: model.name,
          description: model.description,

          prompts: model.prompts,

          tools: model.tools,
        };
      }) ?? [],

      tts: cfg.tts ?? null,
      stt: cfg.stt ?? null,

      workflow: cfg.workflow ?? null,
      recorder: cfg.recorder ?? null,

      voice: cfg.voice ?? null,

      vision: cfg.vision ? {
        files: cfg.vision.files ?? [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
        ],
      } : null,

      text: cfg.text ? {
        files: cfg.text.files ?? [
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
          ".py",
          ".rs",
          ".ts",
        ],
      } : null,

      extractor: cfg.extractor ? {
        files: cfg.extractor.files ?? [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          
          ".msg",
          ".eml",
        ],
      } : null,

      bridge: cfg.bridge ?? null,
      internet: cfg.internet ?? null,
      renderer: cfg.renderer ?? null,
      interpreter: cfg.interpreter ?? null,
      repository: cfg.repository ?? null,
      artifacts: cfg.artifacts ?? null,

      translator: cfg.translator ? {
        model: cfg.translator.model,
        files: cfg.translator.files ?? [],
        languages: cfg.translator.languages ?? ["en", "de", "fr", "it", "es"],
      } : null,

      researcher: cfg.researcher ?? null,

      backgrounds: cfg.backgrounds ?? {},
    }

    if (config.repository && !config.repository.context_pages) {
      config.repository.context_pages = 150;
    }

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
