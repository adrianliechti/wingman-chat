import { describe, expect, it } from "vitest";
import { withRendererFallback, withSynthesizerFallback } from "@/shared/lib/models";
import {
  constrainSelection,
  creationKind,
  durationLabel,
  EMPTY_SELECTION,
  type RenderSelection,
  rendererSubmenus,
} from "./rendererOptions";

const flare = withRendererFallback({ id: "gpt-image-2.6-flare", name: "Flare" });
const legacy = withRendererFallback({ id: "gpt-image-2.5-flare", name: "Flare 2.5" });
const icons = {
  quality: null,
  resolution: null,
  background: null,
  complexity: null,
  format: null,
  frames: null,
  speed: null,
};
const labels = (model: typeof flare, selection: RenderSelection) =>
  rendererSubmenus(model, selection, () => {}, icons).map((submenu) => submenu.label);

describe("render selection", () => {
  const gif: RenderSelection = {
    ...EMPTY_SELECTION,
    quality: "high",
    resolution: "2K",
    background: "transparent",
    format: "gif",
    frameCount: 16,
    frameDurationMs: 100,
  };

  it("keeps GIF frame levers and drops raster-only ones for animated output", () => {
    expect(constrainSelection(flare, gif)).toEqual({
      ...gif,
      resolution: null,
      background: null,
    });
    expect(constrainSelection(flare, { ...gif, format: "svg" })).toMatchObject({
      format: "svg",
      frameCount: null,
      frameDurationMs: null,
    });
  });

  it("falls back to an editable PNG on models without SVG or GIF output", () => {
    expect(constrainSelection(legacy, gif)).toEqual({
      ...gif,
      format: null,
      frameCount: null,
      frameDurationMs: null,
    });
  });

  it("offers format, complexity and GIF levers only where they apply", () => {
    expect(labels(legacy, EMPTY_SELECTION)).toEqual(["Quality", "Resolution", "Background"]);
    expect(labels(flare, EMPTY_SELECTION)).toEqual(["Format", "Quality", "Resolution", "Background", "Complexity"]);
    expect(labels(flare, { ...EMPTY_SELECTION, format: "svg" })).toEqual(["Format", "Quality", "Complexity"]);
    expect(labels(flare, { ...EMPTY_SELECTION, format: "gif" })).toEqual([
      "Format",
      "Quality",
      "Complexity",
      "Frames",
      "Speed",
    ]);
  });

  it("maps the Format and Frames menus onto the selection", () => {
    let next = EMPTY_SELECTION;
    const menu = (selection: RenderSelection, label: string) =>
      rendererSubmenus(flare, selection, (value) => (next = value), icons).find((item) => item.label === label)!;
    expect(menu(EMPTY_SELECTION, "Format").value).toBe("png");
    menu(EMPTY_SELECTION, "Format").onChange("gif");
    expect(next.format).toBe("gif");
    menu(next, "Frames").onChange("32");
    expect(next.frameCount).toBe(32);
    menu(next, "Format").onChange("png");
    expect(next.format).toBeNull();
  });
});

describe("video render selection", () => {
  const omni = withRendererFallback({ id: "google/gemini-omni-1.2-flash", name: "Omni", type: "renderer" });
  it("selects MP4 and keeps video resolution and duration without image controls", () => {
    const selection = constrainSelection(omni, {
      ...EMPTY_SELECTION,
      quality: "high",
      background: "transparent",
      resolution: "720p",
      durationSeconds: 15,
      frameCount: 16,
      frameDurationMs: 100,
    });
    expect(selection).toMatchObject({
      format: "mp4",
      resolution: "720p",
      durationSeconds: 15,
      quality: null,
      background: null,
      frameCount: null,
      frameDurationMs: null,
    });
    expect(labels(omni, selection)).toEqual(["Resolution", "Duration"]);
    expect(constrainSelection(legacy, selection)).toMatchObject({
      format: null,
      durationSeconds: null,
      resolution: null,
    });
  });
  it("drops durations and resolutions the model cannot honor", () => {
    expect(constrainSelection(omni, { ...EMPTY_SELECTION, durationSeconds: 16, resolution: "2K" })).toMatchObject({
      format: "mp4",
      durationSeconds: null,
      resolution: null,
    });
  });

  const lyria = withSynthesizerFallback({ id: "lyria-3.5", name: "Lyria 3.5", type: "synthesizer" });
  it("selects a song for a music model and keeps only its length", () => {
    const selection = constrainSelection(lyria, {
      ...EMPTY_SELECTION,
      aspect: "16:9",
      quality: "medium",
      resolution: "720p",
      background: "transparent",
      format: "gif",
      frameCount: 16,
      durationSeconds: 120,
    });
    expect(selection).toEqual({ ...EMPTY_SELECTION, format: "mp3", durationSeconds: 120 });
    expect(labels(lyria, selection)).toEqual(["Duration"]);
    const [duration] = rendererSubmenus(lyria, selection, () => {}, icons);
    expect(duration.options.map((option) => option.label)).toEqual(["30s", "1 min", "2 min", "3 min"]);
    expect(constrainSelection(lyria, { ...EMPTY_SELECTION, durationSeconds: 15 }).durationSeconds).toBeNull();
    expect(constrainSelection(flare, selection)).toMatchObject({ format: null, durationSeconds: null });
  });
  it("tells what each model creates", () => {
    expect([flare, omni, lyria, null].map(creationKind)).toEqual(["image", "video", "song", "image"]);
  });
  it("labels whole minutes as minutes and everything else in seconds", () => {
    expect([15, 60, 90, 180].map(durationLabel)).toEqual(["15s", "1 min", "90s", "3 min"]);
  });
});
