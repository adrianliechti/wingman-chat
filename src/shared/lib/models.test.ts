import { describe, expect, it } from "vitest";
import { defaultEffort, modelName, shortModelName, supportedEfforts } from "./models";

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
  it("offers xhigh and max only where Anthropic ships both", () => {
    const both: ("low" | "medium" | "high" | "xhigh" | "max")[] = ["low", "medium", "high", "xhigh", "max"];
    expect(supportedEfforts("claude-sonnet-5")).toEqual(both);
    expect(supportedEfforts("claude-opus-5")).toEqual(both);
    expect(supportedEfforts("claude-opus-4-8")).toEqual(both);
    expect(supportedEfforts("claude-opus-4-7")).toEqual(both);
    expect(supportedEfforts("claude-fable-5")).toEqual(both);

    // The 4.6 generation introduced max but not xhigh.
    expect(supportedEfforts("claude-opus-4-6")).toEqual(["low", "medium", "high", "max"]);
    expect(supportedEfforts("eu.anthropic.claude-sonnet-4-6")).toEqual(["low", "medium", "high", "max"]);

    // Opus 4.5 has effort but stops at high; older Claude has no top tiers.
    expect(supportedEfforts("claude-opus-4-5")).toEqual(["low", "medium", "high"]);
    expect(supportedEfforts("claude-haiku-4-5")).toEqual(["low", "medium", "high"]);
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
    expect(defaultEffort("gemini-3.1-pro-preview")).toBeUndefined();
    expect(defaultEffort("poppy")).toBeUndefined();
    expect(supportedEfforts("poppy")).toBeUndefined();
  });
});
