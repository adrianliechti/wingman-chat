import { describe, expect, it } from "vitest";
import { maskPixels, selectionRectangle } from "./mask";
import { GEOMETRY, outputSize, sourceMatrix } from "./geometry";

describe("maskPixels", () => {
  it("makes selected pixels transparent and everything else opaque black", () => {
    // Two pixels: fully selected (white, alpha 255) and untouched (alpha 0),
    // plus a feathered edge at half coverage.
    const coverage = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 128]);
    expect(Array.from(maskPixels(coverage))).toEqual([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 127]);
  });

  it("writes into a provided buffer", () => {
    const out = new Uint8ClampedArray(4);
    expect(maskPixels(new Uint8ClampedArray([9, 9, 9, 10]), out)).toBe(out);
    expect(Array.from(out)).toEqual([0, 0, 0, 245]);
  });
});

it("preserves the area of a screen rectangle after crop, straighten, rotation and flip", () => {
  for (const rotation of [0, 1, 2, 3])
    for (const flipH of [false, true]) {
      const geometry = { ...GEOMETRY, rotation, flipH, angle: 25, crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 } };
      const points = selectionRectangle(
        sourceMatrix(geometry, 600, 400),
        600,
        400,
        { x: 0.2, y: 0.3 },
        { x: 0.7, y: 0.8 },
      );
      const area =
        Math.abs(
          points.reduce((sum, p, i) => {
            const next = points[(i + 1) % points.length];
            return sum + p.x * next.y - p.y * next.x;
          }, 0),
        ) / 2;
      const [w, h] = outputSize(geometry, 600, 400);
      expect(area).toBeCloseTo(w * h * 0.5 * 0.5, 6);
    }
});
