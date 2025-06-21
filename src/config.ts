import { Bridge } from "./lib/bridge";
import { Client } from "./lib/client";
import { Model } from "./models/chat";

interface config {
  title: string;

  models: modelConfig[];
  
  voice?: voiceConfig;
  bridge?: bridgeConfig;
}

interface modelConfig {
  id: string;
  name: string;

  description?: string;
}

interface voiceConfig {
  enabled: boolean;
}

interface bridgeConfig {
  url: string;
}

interface Config {
  title: string;

  client: Client;

  bridge: Bridge;
  voice: boolean;

  models: Model[]; 
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
      
      client: client,

      voice: cfg.voice?.enabled ?? false,
      bridge: bridge,

      models: cfg.models?.map((model) => {
        return {
          id: model.id,

          name: model.name,
          description: model.description,
        };
      }),
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
