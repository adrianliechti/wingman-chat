import { describe, expect, it } from "vitest";
import { modelPickerTiers } from "./modelPicker";
import type { Model } from "@/shared/types/chat";

const poppy: Model = { id: "poppy", name: "Poppy" };
const herby: Model = { id: "herby", name: "Herby" };
const sonnet: Model = { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" };
const opus: Model = { id: "claude-opus-5-5", name: "Claude Opus 5.5" };
const alias: Model = { id: "claude-auto", name: "Claude Auto", hidden: true };
const realtime: Model = { id: "realtime", name: "Real-time Voice" };

const ids = (models: Model[]) => models.map((model) => model.id);

describe("modelPickerTiers", () => {
  it("lists every visible model itself without a slider", () => {
    const tiers = modelPickerTiers([poppy, herby, alias, realtime]);
    expect(ids(tiers.quick)).toEqual(["poppy", "herby"]);
    expect(tiers.all).toEqual([]);
    expect(ids(tiers.hidden)).toEqual(["claude-auto"]);
  });

  it("moves the list behind the slider", () => {
    const tiers = modelPickerTiers([sonnet, opus, alias], { slider: true });
    expect(tiers.quick).toEqual([]);
    expect(ids(tiers.all)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(ids(tiers.hidden)).toEqual(["claude-auto"]);
  });

  it("keeps featured models below the slider", () => {
    const tiers = modelPickerTiers([{ ...poppy, featured: true }, sonnet], { slider: true });
    expect(ids(tiers.quick)).toEqual(["poppy"]);
    expect(ids(tiers.all)).toEqual(["poppy", "claude-sonnet-5-5"]);
    expect(ids(modelPickerTiers([{ ...poppy, featured: true }]).quick)).toEqual(["poppy"]);
    expect(modelPickerTiers([{ ...poppy, featured: true }], { slider: true }).all).toEqual([]);
  });

  it("needs no list behind the slider for its own stop alone", () => {
    const auto: Model = { id: "auto", name: "Auto" };
    expect(ids(modelPickerTiers([auto, poppy], { slider: true, exclude: "auto" }).all)).toEqual(["auto", "poppy"]);
    expect(modelPickerTiers([auto], { slider: true, exclude: "auto" }).all).toEqual([]);
  });
});
