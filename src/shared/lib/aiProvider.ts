import { createModel, extendAdapter } from "@tanstack/ai";
import {
  type OpenAIChatModel,
  type OpenAITextConfig,
  createOpenaiEmbedding,
  createOpenaiSpeech,
  createOpenaiTranscription,
} from "@tanstack/ai-openai";

import { GatewayTextAdapter } from "./gatewayText";

function createGatewayChat<TModel extends OpenAIChatModel>(
  model: TModel,
  apiKey: string,
  config?: Omit<OpenAITextConfig, "apiKey">,
) {
  // The gateway deliberately preserves tool schemas with strict: false across
  // providers, so OpenAI's strict-mode fallback diagnostic is expected here.
  // The SDK timeout ends at response headers; streaming has no time limit.
  return new GatewayTextAdapter({ apiKey, timeout: 60_000, strictFallbackWarning: false, ...config }, model);
}

// Model ids are discovered from the Wingman gateway, including deployment aliases.
const gatewayModels = [createModel("" as string, ["text", "image", "audio", "document"])];
export const gatewayText = extendAdapter(createGatewayChat, gatewayModels);
export const gatewayEmbedding = extendAdapter(createOpenaiEmbedding, gatewayModels);
export const gatewaySpeech = extendAdapter(createOpenaiSpeech, gatewayModels);
export const gatewayTranscription = extendAdapter(createOpenaiTranscription, gatewayModels);

/** The Go proxy supplies deployment credentials. No server key is bundled into the SPA. */
export function browserProviderConfig(signal?: AbortSignal) {
  return {
    baseURL: new URL("/api/v1", window.location.origin).href,
    dangerouslyAllowBrowser: true,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      signal?.throwIfAborted();
      // An empty model selects the gateway's default deployment. Multipart
      // requests previously omitted it; the provider SDK always writes it.
      if (init?.body instanceof FormData && init.body.get("model") === "") init.body.delete("model");
      return fetch(input, {
        ...init,
        signal: signal && init?.signal ? AbortSignal.any([signal, init.signal]) : (signal ?? init?.signal),
      });
    },
  };
}
