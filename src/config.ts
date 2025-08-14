import { Bridge } from "./lib/bridge";
import { Client } from "./lib/client";
import { Model } from "./types/chat";

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
  voice?: voiceConfig;
  vision?: visionConfig;
  
  bridge?: bridgeConfig;
  internet?: internetConfig;
  artifacts?: artifactsConfig;
  repository?: repositoryConfig;  
  translator?: translatorConfig;
}

interface modelConfig {
  id: string;
  name: string;

  description?: string;

  prompts?: string[];
}

interface ttsConfig {
  enabled: boolean;
}

interface sttConfig {
   enabled: boolean;
}

interface voiceConfig {
  enabled: boolean;
}

interface visionConfig {
  enabled: boolean;
}

interface bridgeConfig {
  url: string;
}

interface internetConfig {
  enabled: boolean;
}

interface repositoryConfig {
  enabled: boolean;
  embedder?: string;
  extractor?: string;
}

interface artifactsConfig {
  enabled: boolean;
}

interface translatorConfig {
  enabled: boolean;
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
  voice: boolean;
  vision: boolean;
  
  bridge: Bridge;

  internet: internetConfig;
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
        };
      }) ?? [],

      tts: cfg.tts?.enabled ?? false,
      stt: cfg.stt?.enabled ?? false,
      
      voice: cfg.voice?.enabled ?? false,
      vision: cfg.vision?.enabled ?? false,
      
      bridge: bridge,

      internet: cfg.internet ?? {
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
