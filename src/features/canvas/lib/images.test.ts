// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { imageDimensions, viewOnlyFormat } from "./images";

describe("canvas images", () => {
  it("routes vector and animated images to the viewer", () => {
    expect(viewOnlyFormat("data:image/svg+xml;base64,PHN2Zy8+")).toBe("svg");
    expect(viewOnlyFormat("data:image/gif;base64,R0lGOD")).toBe("gif");
    expect(viewOnlyFormat("data:image/png;base64,iVBOR")).toBeNull();
    expect(viewOnlyFormat("")).toBeNull();
  });

  it("measures SVG from its markup instead of decoding it", async () => {
    const svg = (attributes: string) =>
      new Blob([`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`], { type: "image/svg+xml" });
    expect(await imageDimensions(svg('width="640px" height="480"'))).toEqual({ width: 640, height: 480 });
    expect(await imageDimensions(svg('width="100%" viewBox="0 0 1024 576.4"'))).toEqual({ width: 1024, height: 576 });
  });
});
