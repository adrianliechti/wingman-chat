import { describe, expect, it } from "vitest";
import { withRendererFallback } from "@/shared/lib/models";
import { constrainSelection, EMPTY_SELECTION, type RenderSelection, rendererSubmenus } from "./rendererOptions";

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
