import { describe, expect, it } from "vitest";
import { modelPresetIndex, resolveModelPresets } from "./modelPresets";
import type { Model } from "@/shared/types/chat";

const luna: Model = {
  id: "gpt-6-luna",
  name: "GPT-6 Luna",
  supportedEfforts: ["none", "low", "medium", "high"],
  defaultEffort: "medium",
};
const astra: Model = { id: "gpt-6-astra", name: "GPT-6 Astra", supportedEfforts: ["low", "medium", "high"] };
const plain: Model = { id: "plain", name: "Plain" };

describe("resolveModelPresets", () => {
  it("drops unavailable models and keeps order", () => {
    const presets = resolveModelPresets(
      [
        { model: "gpt-6-luna", effort: "low" },
        { model: "missing", effort: "high" },
        { model: "gpt-6-astra", effort: "high", label: "Astra" },
      ],
      [luna, astra],
    );
    expect(presets.map((p) => [p.model.id, p.effort, p.label])).toEqual([
      ["gpt-6-luna", "low", "GPT-6 Luna"],
      ["gpt-6-astra", "high", "Astra"],
    ]);
  });

  it("falls back to the default effort when the configured one is unsupported", () => {
    const [preset] = resolveModelPresets([{ model: "gpt-6-luna", effort: "max" }], [luna]);
    expect(preset.effort).toBe("medium");
  });

  it("uses the preset verbosity, else the model's", () => {
    const presets = resolveModelPresets(
      [{ model: "gpt-6-luna", verbosity: "low" }, { model: "gpt-6-astra" }],
      [luna, { ...astra, verbosity: "high" }],
    );
    expect(presets.map((p) => p.verbosity)).toEqual(["low", "high"]);
  });

  it("keeps models without effort levels", () => {
    const [preset] = resolveModelPresets([{ model: "plain" }], [plain]);
    expect(preset.effort).toBeUndefined();
  });
});

describe("modelPresetIndex", () => {
  const presets = resolveModelPresets(
    [{ model: "gpt-6-luna", effort: "low" }, { model: "gpt-6-luna" }, { model: "gpt-6-astra", effort: "high" }],
    [luna, astra],
  );

  it("matches model and effort, treating an unset effort as the default", () => {
    expect(modelPresetIndex(presets, { ...luna, effort: "low" })).toBe(0);
    expect(modelPresetIndex(presets, luna)).toBe(1);
    expect(modelPresetIndex(presets, { ...astra, effort: "high" })).toBe(2);
  });

  it("tells apart steps that differ only in verbosity", () => {
    const steps = resolveModelPresets(
      [
        { model: "gpt-6-luna", verbosity: "low" },
        { model: "gpt-6-luna", verbosity: "high" },
      ],
      [luna],
    );
    expect(modelPresetIndex(steps, { ...luna, verbosity: "high" })).toBe(1);
    expect(modelPresetIndex(steps, luna)).toBe(-1);
  });

  it("returns -1 for selections outside the slider", () => {
    expect(modelPresetIndex(presets, { ...astra, effort: "low" })).toBe(-1);
    expect(modelPresetIndex(presets, null)).toBe(-1);
  });
});
