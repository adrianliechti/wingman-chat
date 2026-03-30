import { Client } from "./lib/client";
import type { MCP, Model } from "./types/chat";

interface backgroundConfig {
  url: string;
}

interface backgroundPackConfig {
  [packName: string]: backgroundConfig[];
}

interface supportConfig {
  url?: string;
  email?: string;
}

interface config {
  title: string;
  disclaimer: string;
  support?: supportConfig;

  tools: toolConfig[];
  models: modelConfig[];

  backgrounds?: backgroundPackConfig;

  tts?: ttsConfig;
  stt?: sttConfig;

  notebook?: notebookConfig;
  workflow?: workflowConfig;

  voice?: voiceConfig;
  vision?: visionConfig;

  text?: textConfig;

  internet?: internetConfig;

  renderer?: rendererConfig;
  extractor?: extractorConfig;

  memory?: memoryConfig;

  artifacts?: artifactsConfig;
  repository?: repositoryConfig;
  translator?: translatorConfig;

  chat?: chatConfig;
}

interface modelConfig {
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

interface toolConfig {
  id: string;

  url: string;

  name: string;
  description: string;

  icon?: string;
}

interface ttsConfig {
  model?: string;
  voices?: Record<string, string>;
}

interface sttConfig {
  model?: string;
}

interface notebookConfig {
  model?: string;
}

interface workflowConfig {
  model?: string;
}

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
  model?: string;
  disclaimer?: string;
  elicitation?: boolean;
}

interface internetConfig {
  scraper?: string;
  searcher?: string;
  researcher?: string;
  elicitation?: boolean;
}

interface extractorConfig {
  model?: string;
  files: string[];
}

interface repositoryConfig {
  embedder?: string;
  extractor?: string;

  context_pages?: number;
}

type memoryConfig = object;

type artifactsConfig = object;

interface translatorConfig {
  model?: string;
  files: string[];

  languages: string[];
}

interface chatConfig {
  retentionDays?: number;
}

interface Config {
  title: string;
  disclaimer: string;
  support: supportConfig | null;

  client: Client;

  mcps: MCP[];
  models: Model[];

  tts: ttsConfig | null;
  stt: sttConfig | null;

  notebook: notebookConfig | null;
  workflow: workflowConfig | null;

  voice: voiceConfig | null;
  vision: visionConfig | null;

  text: textConfig | null;
  extractor: extractorConfig | null;

  internet: internetConfig | null;

  renderer: rendererConfig | null;

  memory: memoryConfig | null;

  artifacts: artifactsConfig | null;
  repository: repositoryConfig | null;
  translator: translatorConfig | null;

  chat: chatConfig | null;

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
      support: cfg.support ?? null,

      client: client,

      mcps:
        cfg.tools?.map((mcp) => {
          return {
            id: mcp.id,

            url: mcp.url ?? new URL(`/api/v1/mcp/${mcp.id}`, window.location.origin).toString(),

            name: mcp.name,
            description: mcp.description,

            icon: mcp.icon,
          };
        }) ?? [],

      models:
        cfg.models?.map((model) => {
          return {
            id: model.id,

            name: model.name,
            description: model.description,

            effort: model.effort,
            summary: model.summary,
            verbosity: model.verbosity,
            compactThreshold: model.compactThreshold,

            prompts: model.prompts,

            tools: model.tools,
          };
        }) ?? [],

      tts: cfg.tts
        ? {
            model: cfg.tts.model,
            voices: cfg.tts.voices ?? {
              host: "nova",
              analyst: "onyx",
              narrator: "alloy",
              storyteller: "fable",
              skeptic: "echo",
            },
          }
        : null,
      stt: cfg.stt ?? null,

      notebook: cfg.notebook ?? null,
      workflow: cfg.workflow ?? null,

      voice: cfg.voice ?? null,

      vision: cfg.vision
        ? {
            files: cfg.vision.files ?? ["image/jpeg", "image/png", "image/gif", "image/webp"],
          }
        : null,

      text: {
        files: cfg.text?.files ?? [
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
        ],
      },

      extractor: cfg.extractor
        ? {
            files: cfg.extractor.files ?? [
              "application/pdf",
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

              ".msg",
              ".eml",
            ],
          }
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
            languages: cfg.translator.languages ?? ["en", "de", "fr", "it", "es"],
          }
        : null,

      chat: cfg.chat ?? null,

      backgrounds: cfg.backgrounds ?? {},
    };

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
