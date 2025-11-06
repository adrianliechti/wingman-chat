import { Bridge } from "./lib/bridge";
import { Client } from "./lib/client";
import type { Model } from "./types/chat";

interface backgroundConfig {
  url: string;
}

interface backgroundPackConfig {
  [packName: string]: backgroundConfig[];
}

interface config {
  title: string;
  disclaimer: string;

  models: modelConfig[];
  backgrounds?: backgroundPackConfig;
  
  tts?: ttsConfig;
  stt?: sttConfig;

  workflow?: workflowConfig;

  voice?: voiceConfig;
  vision?: visionConfig;
  
  image?: imageConfig;
  
  bridge?: bridgeConfig;
  internet?: internetConfig;
  interpreter?: interpreterConfig;
  
  artifacts?: artifactsConfig;
  repository?: repositoryConfig;  
  translator?: translatorConfig;
}

interface modelConfig {
  id: string;
  name: string;

  model?: string;
  description?: string;

  mcp: string[];
  prompts?: string[];
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

interface imageConfig {
  enabled: boolean;
  model?: string
}

interface bridgeConfig {
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

  models: Model[];

  tts: boolean;
  stt: boolean;
  
  workflow: boolean;
  
  voice: boolean;
  vision: boolean;

  image: imageConfig;
  
  bridge: Bridge;

  internet: internetConfig;
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

    const cfg : config = await resp.json();

    const bridgeUrl = cfg.bridge?.url ?? ""

    const client = new Client();
    const bridge = Bridge.create(bridgeUrl);

    config = {
      title : cfg.title,
      disclaimer: cfg.disclaimer,
      
      client: client,

      models: cfg.models?.map((model) => {
        return {
          id: model.id,

          name: model.name,
          description: model.description,

          prompts: model.prompts,

          mcpServer: model.mcp && model.mcp.length > 0 ? new URL(`/api/v1/mcp/${model.mcp[0]}`, window.location.origin).toString() : undefined,
        };
      }) ?? [],

      tts: cfg.tts?.enabled ?? false,
      stt: cfg.stt?.enabled ?? false,
      
      workflow: cfg.workflow?.enabled ?? false,
      
      voice: cfg.voice?.enabled ?? false,
      vision: cfg.vision?.enabled ?? false,
      
      image: cfg.image ?? {
        enabled: false,
      },
      
      bridge: bridge,

      internet: cfg.internet ?? {
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
