import { describe, expect, it } from "vitest";
import {
  compactThreshold,
  configureModels,
  defaultEffort,
  minimalEffort,
  modelName,
  modelType,
  rendererCapabilities,
  shortModelName,
  supportedEfforts,
} from "./models";

describe("model endpoint detection", () => {
  it.each([
    ["gpt-realtime-2.1", "realtime"],
    ["openai/gpt-4o-realtime-preview", "realtime"],
    ["gpt-live-transcribe", "realtime"],
    ["voxtral-mini-transcribe-live", "realtime"],
    ["gemini-3.1-flash-live-preview", "realtime"],
    ["gemini-live-2.5-flash-preview", "realtime"],
    ["gemini-2.5-flash-native-audio-preview", "realtime"],
    ["amazon.nova-2-sonic-v1:0", "realtime"],
    ["gpt-transcribe", "transcriber"],
    ["gpt-4o-mini-transcribe", "transcriber"],
    ["mai-transcribe-1.5", "transcriber"],
    ["voxtral-mini-transcribe", "transcriber"],
    ["audio-whisper-large-v3", "transcriber"],
    ["speech-stt", "transcriber"],
    ["gpt-4o-mini-tts", "synthesizer"],
    ["voxtral-mini-tts", "synthesizer"],
    ["mai-voice-2", "synthesizer"],
    ["eleven_multilingual_v2", "synthesizer"],
    ["gemini-2.5-flash-preview-tts", "synthesizer"],
    ["gpt-audio", "completer"],
    ["gpt-4o-audio-preview", "completer"],
    ["Qwen/Qwen2.5-Omni-7B", "completer"],
    ["auto", "completer"],
    ["my-custom-deployment", "completer"],
    ["claude-fable-5-1", "completer"],
    ["claude-mythos-5-1", "completer"],
    ["gpt-6-astra", "completer"],
    ["budget-chat", "completer"],
    ["eclipse-chat", "completer"],
    ["BGE-reranker-v2-m3", "reranker"],
    ["jina-reranker-v2-base-multilingual", "reranker"],
    ["cohere.rerank-v3-5:0", "reranker"],
    ["bge-m3", "embedder"],
    ["sentence-transformers/all-MiniLM-L6-v2", "embedder"],
    ["openai/clip-vit-large-patch14", "embedder"],
    ["text-embedding-3-large", "embedder"],
    ["mistral-embed", "embedder"],
    ["gemini-embedding-2", "embedder"],
    ["gpt-image-2", "renderer"],
    ["gemini-3.1-flash-image", "renderer"],
    ["imagen-4", "renderer"],
    ["dall-e-3", "renderer"],
    ["black-forest-labs/FLUX.1-schnell", "renderer"],
  ])("routes %s to %s", (id, expected) => {
    expect(modelType(id)).toBe(expected);
  });
});

describe("model display names", () => {
  it("omits Anthropic and OpenAI from compact chat labels", () => {
    expect(shortModelName("anthropic.claude-sonnet-4-5")).toBe("Claude Sonnet 4.5");
    expect(shortModelName("openai.gpt-5-2")).toBe("GPT 5.2");
    expect(shortModelName("eu.anthropic.claude-sonnet-4-5-20251001")).toBe("Claude Sonnet 4.5");
  });

  it("keeps full names and unrelated vendors unchanged", () => {
    expect(modelName("anthropic.claude-sonnet-4-5")).toBe("Anthropic Claude Sonnet 4.5");
    expect(shortModelName("google.gemini-3-pro")).toBe("Google Gemini 3 Pro");
  });
});

describe("reasoning effort levels", () => {
  it("offers Qwen 3.8's distinct effort levels, excluding the high/max aliases", () => {
    expect(supportedEfforts("qwen3.8-max")).toEqual(["none", "low", "medium", "xhigh"]);
    expect(supportedEfforts("qwen3.8-flash")).toEqual(["none", "low", "medium", "xhigh"]);
    expect(defaultEffort("qwen3.8-max")).toBe("xhigh");
    expect(supportedEfforts("qwen2.5-72b")).toBeUndefined();
  });

  it("uses the current Astra and GPT-5.6 efforts instead of extrapolating GPT-5.2", () => {
    expect(supportedEfforts("gpt-6-astra")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(minimalEffort("openai/gpt-6-astra")).toBe("low");
    for (const id of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(supportedEfforts(id)).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
      expect(defaultEffort(id)).toBe("medium");
    }
  });

  it("distinguishes Gemini revisions and never invents effort settings for non-chat or future models", () => {
    expect(supportedEfforts("gemini-3.8-flash")).toEqual(["low", "medium", "high"]);
    expect(supportedEfforts("gemini-3.7-flash")).toEqual(["low", "medium", "high"]);
    expect(supportedEfforts("gemini-3.6-flash")).toEqual(["minimal", "low", "medium", "high"]);
    expect(supportedEfforts("gemini-3-pro-preview")).toEqual(["low", "high"]);
    for (const id of [
      "gemini-embedding-2",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-live-preview",
      "gpt-7",
      "gpt-5.99",
      "claude-opus-8",
      "qwen3-embedding-8b",
      "o3-pro",
    ]) {
      expect(supportedEfforts(id)).toBeUndefined();
      expect(defaultEffort(id)).toBeUndefined();
    }
  });

  it("does not mistake GPT Pro variants for their base models", () => {
    expect(supportedEfforts("gpt-5.4-pro")).toEqual(["medium", "high", "xhigh"]);
    expect(defaultEffort("gpt-5.4-pro")).toBe("medium");
    expect(supportedEfforts("gpt-5.4-mini")).toEqual(["none", "low", "medium", "high", "xhigh"]);
  });

  it("selects the lowest supported effort for inexpensive helper calls", () => {
    expect(minimalEffort("gpt-5.4-nano")).toBe("none");
    expect(minimalEffort("gpt-5-nano")).toBe("minimal");
    expect(minimalEffort("claude-fable-5-1")).toBe("low");
    expect(minimalEffort("claude-haiku-4-5")).toBeUndefined();
    expect(minimalEffort("poppy")).toBeUndefined();
  });

  it("offers xhigh and max only where Anthropic ships both", () => {
    const both: ("low" | "medium" | "high" | "xhigh" | "max")[] = ["low", "medium", "high", "xhigh", "max"];
    expect(supportedEfforts("claude-sonnet-5")).toEqual(both);
    expect(supportedEfforts("claude-opus-5")).toEqual(both);
    expect(supportedEfforts("claude-opus-4-8")).toEqual(both);
    expect(supportedEfforts("claude-opus-4-7")).toEqual(both);
    expect(supportedEfforts("claude-fable-5")).toEqual(both);
    expect(supportedEfforts("claude-fable-5-1")).toEqual(both);
    expect(supportedEfforts("claude-mythos-5-1")).toEqual(both);
    expect(supportedEfforts("claude-mythos-preview")).toEqual(["low", "medium", "high", "max"]);

    // The 4.6 generation introduced max but not xhigh.
    expect(supportedEfforts("claude-opus-4-6")).toEqual(["low", "medium", "high", "max"]);
    expect(supportedEfforts("eu.anthropic.claude-sonnet-4-6")).toEqual(["low", "medium", "high", "max"]);

    // Opus 4.5 has effort but stops at high; older Claude has no top tiers.
    expect(supportedEfforts("claude-opus-4-5")).toEqual(["low", "medium", "high"]);
    expect(supportedEfforts("claude-haiku-4-5")).toBeUndefined();
  });

  it("badges only vendor-documented defaults", () => {
    expect(defaultEffort("claude-sonnet-5")).toBe("high");
    expect(defaultEffort("claude-opus-4-6")).toBe("high");
    // OpenAI documents medium for gpt-5.5 and gpt-5.6, not the smaller variants.
    expect(defaultEffort("gpt-5.5")).toBe("medium");
    expect(defaultEffort("gpt-5-5")).toBe("medium");
    expect(defaultEffort("gpt-5.6-terra")).toBe("medium");
    expect(defaultEffort("gpt-5.5-mini")).toBeUndefined();
    // Undocumented defaults and aliased ids fall back to config's `effort`.
    expect(defaultEffort("gpt-5.2")).toBeUndefined();
    expect(defaultEffort("gemini-3.1-pro-preview")).toBe("high");
    expect(defaultEffort("poppy")).toBeUndefined();
    expect(supportedEfforts("poppy")).toBeUndefined();
  });
});

describe("configured model catalogue", () => {
  it("keeps old/new context budgets consistent for dotted and hyphenated model versions", () => {
    for (const id of ["claude-sonnet-4.5", "claude-sonnet-4-5", "bedrock-opus-4", "claude-haiku-4-5"]) {
      expect(compactThreshold(id)).toBe(176_000);
    }
    for (const id of [
      "claude-sonnet-4.6",
      "claude-sonnet-4-6",
      "bedrock-opus-4-8",
      "claude-fable-5-1",
      "gpt-6-astra",
    ]) {
      expect(compactThreshold(id)).toBe(272_000);
    }
    expect(compactThreshold("gpt-4o-mini")).toBe(100_000);
  });

  it("resolves config type before capabilities and filtering, retaining API metadata", () => {
    const result = configureModels(
      [
        { id: "opaque", name: "API name", type: "completer", description: "Backend description" },
        { id: "gpt-6-astra", name: "Astra", type: "completer" },
      ],
      [
        { id: "opaque", name: "Studio", type: "renderer", supportedQualities: [] },
        { id: "gpt-6-astra", name: "Custom", supportedEfforts: [], compactThreshold: 0 },
        { id: "unavailable", name: "Not authorized", type: "completer" },
      ],
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "Studio",
      type: "renderer",
      description: "Backend description",
      supportedQualities: [],
    });
    expect(result[0].supportedEfforts).toBeUndefined();
    expect(result[1]).toMatchObject({ supportedEfforts: [], compactThreshold: 0 });
    expect(result[1].defaultEffort).toBeUndefined();
  });

  it("never badges a default effort the configured supported levels exclude", () => {
    const [model] = configureModels(
      [{ id: "claude-fable-5-1", name: "Fable" }],
      [{ id: "claude-fable-5-1", name: "Fable", supportedEfforts: ["low", "medium"] }],
    );
    expect(model.defaultEffort).toBeUndefined();
    expect(model.supportedEfforts).toEqual(["low", "medium"]);
    expect(minimalEffort({ id: "opaque", name: "Alias", supportedEfforts: ["medium", "high"] })).toBe("medium");
    expect(minimalEffort({ ...model, supportedEfforts: [] })).toBeUndefined();
  });

  it("matches the gateway's image controls without claiming unsupported resolutions", () => {
    expect(rendererCapabilities("gpt-image-2").aspectRatios).toEqual(["1:1", "3:2", "2:3", "16:9", "9:16"]);
    expect(rendererCapabilities("gpt-image-2").backgrounds).toBeUndefined(); // gateway does not forward the preview yet
    expect(rendererCapabilities("gemini-2.5-flash-image").resolutions).toEqual(["1K"]);
    expect(rendererCapabilities("gemini-3.1-flash-lite-image").resolutions).toEqual(["1K"]);
    expect(rendererCapabilities("gemini-3.1-flash-image").resolutions).toEqual(["512", "1K", "2K", "4K"]);
    expect(rendererCapabilities("gemini-3-pro-image").resolutions).toEqual(["1K", "2K", "4K"]);
    expect(rendererCapabilities("gpt-image-20").backgrounds).toBeUndefined();
  });
});
