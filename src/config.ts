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

  voice?: voiceConfig;
  vision?: visionConfig;

  bridge?: bridgeConfig;
  internet?: internetConfig;

  renderer?: rendererConfig;
  interpreter?: interpreterConfig;

  artifacts?: artifactsConfig;
  repository?: repositoryConfig;
  translator?: translatorConfig;
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
  enabled: boolean;
}

interface sttConfig {
  enabled: boolean;
}

interface workflowConfig {
  enabled: boolean;
}

interface voiceConfig {
  enabled: boolean;
}

interface visionConfig {
  enabled: boolean;
}

interface rendererConfig {
  enabled: boolean;
  model?: string
}

interface bridgeConfig {
  enabled: boolean;

  url: string;
}

interface internetConfig {
  enabled: boolean;
}

interface interpreterConfig {
  enabled: boolean;
}

interface repositoryConfig {
  enabled: boolean;

  embedder?: string;
  extractor?: string;

  context_pages?: number;
}

interface artifactsConfig {
  enabled: boolean;
}

interface translatorConfig {
  enabled: boolean;

  model?: string
  files: string[];

  languages: string[];
}

interface Config {
  title: string;
  disclaimer: string;

  client: Client;

  mcps: MCP[];
  models: Model[];  

  tts: boolean;
  stt: boolean;

  workflow: boolean;

  voice: boolean;
  vision: boolean;

  bridge: bridgeConfig;
  internet: internetConfig;

  renderer: rendererConfig;
  interpreter: interpreterConfig;

  artifacts: artifactsConfig;
  repository: repositoryConfig;
  translator: translatorConfig;

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
      
      tts: cfg.tts?.enabled ?? false,
      stt: cfg.stt?.enabled ?? false,

      workflow: cfg.workflow?.enabled ?? false,

      voice: cfg.voice?.enabled ?? false,
      vision: cfg.vision?.enabled ?? false,
      
      bridge: cfg.bridge ?? {
        enabled: false,
        url: ""
      },

      internet: cfg.internet ?? {
        enabled: false,
      },

      renderer: cfg.renderer ?? {
        enabled: false,
      },

      interpreter: cfg.interpreter ?? {
        enabled: false,
      },

      repository: cfg.repository ?? {
        enabled: false
      },

      artifacts: cfg.artifacts ?? {
        enabled: false
      },

      translator: cfg.translator ?? {
        enabled: true,

        files: [
          // ".txt",
          // ".md",
          // ".pdf",
          // ".docx",
          // ".pptx",
          // ".xlsx",
        ],

        languages: [
          "en",
          "de",
          "fr",
          "it",
          "es",
        ],
      },

      backgrounds: cfg.backgrounds ?? {},
    }

    if (config.repository.enabled && !config.repository.context_pages) {
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
