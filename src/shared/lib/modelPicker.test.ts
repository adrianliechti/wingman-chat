import { describe, expect, it } from "vitest";
import { modelPickerTiers } from "./modelPicker";
import type { Model } from "@/shared/types/chat";

const poppy: Model = { id: "poppy", name: "Poppy", featured: true };
const herby: Model = { id: "herby", name: "Herby", featured: true };
const sonnet: Model = { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" };
const opus: Model = { id: "claude-opus-5-5", name: "Claude Opus 5.5" };
const alias: Model = { id: "claude-auto", name: "Claude Auto", hidden: true };
const realtime: Model = { id: "realtime", name: "Real-time Voice" };

const ids = (models: Model[]) => models.map((model) => model.id);

describe("modelPickerTiers", () => {
  it("lists featured models itself and everything visible one level down", () => {
    const tiers = modelPickerTiers([poppy, herby, sonnet, opus, alias], { slider: true });
    expect(ids(tiers.quick)).toEqual(["poppy", "herby"]);
    expect(ids(tiers.all)).toEqual(["poppy", "herby", "claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(ids(tiers.hidden)).toEqual(["claude-auto"]);
  });

  it("splits the same way without a slider", () => {
    const tiers = modelPickerTiers([poppy, sonnet]);
    expect(ids(tiers.quick)).toEqual(["poppy"]);
    expect(ids(tiers.all)).toEqual(["poppy", "claude-sonnet-5-5"]);
  });

  it("needs no second level when the featured models are the whole list", () => {
    const tiers = modelPickerTiers([poppy, herby, alias], { slider: true });
    expect(ids(tiers.quick)).toEqual(["poppy", "herby"]);
    expect(tiers.all).toEqual([]);
    expect(ids(tiers.hidden)).toEqual(["claude-auto"]);
  });

  it("lists an uncurated catalogue itself", () => {
    const tiers = modelPickerTiers([sonnet, opus, realtime]);
    expect(ids(tiers.quick)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(tiers.all).toEqual([]);
  });

  it("moves an uncurated catalogue behind the slider", () => {
    const tiers = modelPickerTiers([sonnet, opus], { slider: true });
    expect(tiers.quick).toEqual([]);
    expect(ids(tiers.all)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
  });

  it("leaves the slider's own stop out of the quick picks", () => {
    const auto: Model = { id: "auto", name: "Auto", featured: true };
    const tiers = modelPickerTiers([auto, poppy, sonnet], { slider: true, exclude: "auto" });
    expect(ids(tiers.quick)).toEqual(["poppy"]);
    expect(ids(tiers.all)).toEqual(["auto", "poppy", "claude-sonnet-5-5"]);
    // On its own, that stop is no reason for a second level.
    expect(modelPickerTiers([auto, poppy], { slider: true, exclude: "auto" }).all).toEqual([]);
  });
});
