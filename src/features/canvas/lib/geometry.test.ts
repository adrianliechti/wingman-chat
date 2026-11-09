import { describe, expect, it } from "vitest";
import {
  applyMatrix,
  cropPixelRatio,
  fitAspect,
  flipGeometry,
  FULL_CROP,
  GEOMETRY,
  type Geometry,
  largestCrop,
  normalizeGeometry,
  outputSize,
  rotateGeometry,
  sourceMatrix,
} from "./geometry";

const close = (actual: [number, number], expected: [number, number]) => {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
};
const closeGeometry = (actual: Geometry, expected: Geometry) => {
  expect({ ...actual, crop: undefined }).toEqual({ ...expected, crop: undefined });
  for (const key of ["x", "y", "width", "height"] as const) expect(actual.crop[key]).toBeCloseTo(expected.crop[key], 9);
};

describe("geometry", () => {
  it("maps output to source one-to-one without edits", () => {
    const m = sourceMatrix(GEOMETRY, 3000, 2000);
    close(applyMatrix(m, 0, 0), [0, 0]);
    close(applyMatrix(m, 1, 1), [1, 1]);
    close(applyMatrix(m, 0.25, 0.75), [0.25, 0.75]);
    expect(outputSize(GEOMETRY, 3000, 2000)).toEqual([3000, 2000]);
  });

  it("crops within the source and sizes the output accordingly", () => {
    const geometry = { ...GEOMETRY, crop: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 } };
    const m = sourceMatrix(geometry, 1000, 800);
    close(applyMatrix(m, 0, 0), [0.5, 0.25]);
    close(applyMatrix(m, 1, 1), [1, 0.75]);
    expect(outputSize(geometry, 1000, 800)).toEqual([500, 400]);
  });

  it("swaps the output size and rotates coordinates for a quarter turn", () => {
    const geometry = { ...GEOMETRY, rotation: 1 };
    expect(outputSize(geometry, 3000, 2000)).toEqual([2000, 3000]);
    const m = sourceMatrix(geometry, 3000, 2000);
    // Clockwise turn: the output's top-left shows the source's bottom-left.
    close(applyMatrix(m, 0, 0), [0, 1]);
    close(applyMatrix(m, 1, 0), [0, 0]);
    close(applyMatrix(m, 1, 1), [1, 0]);
  });

  it("mirrors with flips", () => {
    close(applyMatrix(sourceMatrix({ ...GEOMETRY, flipH: true }, 10, 10), 0, 0.3), [1, 0.3]);
    close(applyMatrix(sourceMatrix({ ...GEOMETRY, flipV: true }, 10, 10), 0.3, 0), [0.3, 1]);
  });

  it("straightens around the center and keeps it fixed", () => {
    const m = sourceMatrix({ ...GEOMETRY, angle: 10 }, 3000, 2000);
    close(applyMatrix(m, 0.5, 0.5), [0.5, 0.5]);
    const [x, y] = applyMatrix(m, 1, 0.5);
    expect(x).toBeLessThan(1);
    expect(y).not.toBeCloseTo(0.5, 3);
  });

  it("finds the largest crop that stays inside a straightened canvas", () => {
    expect(largestCrop(0, 3000, 2000)).toEqual(FULL_CROP);
    const crop = largestCrop(10, 3000, 2000);
    expect(crop.width).toBeLessThan(1);
    expect(crop.height).toBeLessThan(1);
    expect(crop.x).toBeCloseTo((1 - crop.width) / 2, 9);
    // Keeps the requested ratio in canvas pixels.
    expect((crop.width * 3000) / (crop.height * 2000)).toBeCloseTo(1.5, 6);
    const square = largestCrop(0, 3000, 2000, 1);
    expect((square.width * 3000) / (square.height * 2000)).toBeCloseTo(1, 6);
  });

  it("fits a crop to an aspect ratio around its center", () => {
    const fitted = fitAspect(FULL_CROP, 2);
    expect(fitted).toEqual({ x: 0, y: 0.25, width: 1, height: 0.5 });
    expect(fitAspect(FULL_CROP, 0)).toEqual(FULL_CROP);
  });

  it("turns the crop with the picture and comes back after four quarter turns", () => {
    const start = { ...GEOMETRY, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } };
    const turned = rotateGeometry(start, 1);
    expect(turned.rotation).toBe(1);
    // The crop's top-left corner moves to the top-right after a clockwise turn.
    expect(turned.crop).toEqual({ x: 1 - 0.2 - 0.4, y: 0.1, width: 0.4, height: 0.5 });
    // The same pixels stay in the frame: output size swaps but area is unchanged.
    expect(outputSize(turned, 3000, 2000)).toEqual([800, 1500]);
    expect(outputSize(start, 3000, 2000)).toEqual([1500, 800]);
    let geometry = start;
    for (let i = 0; i < 4; i++) geometry = rotateGeometry(geometry, 1);
    expect(geometry.rotation).toBe(0);
    expect(geometry.crop.x).toBeCloseTo(start.crop.x, 9);
    expect(geometry.crop.y).toBeCloseTo(start.crop.y, 9);
    expect(geometry.crop.width).toBeCloseTo(start.crop.width, 9);
    expect(geometry.crop.height).toBeCloseTo(start.crop.height, 9);
    closeGeometry(rotateGeometry(rotateGeometry(start, 1), -1), start);
    expect(rotateGeometry(GEOMETRY, 1).crop).toEqual(GEOMETRY.crop);
  });

  it("mirrors the crop with a flip and negates the straighten angle", () => {
    const start = { ...GEOMETRY, angle: 5, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } };
    const flipped = flipGeometry(start, "horizontal");
    expect(flipped.flipH).toBe(true);
    expect(flipped.angle).toBe(-5);
    expect(flipped.crop.x).toBeCloseTo(0.4, 9);
    closeGeometry(flipGeometry(flipped, "horizontal"), start);
    const vertical = flipGeometry(start, "vertical");
    expect(vertical.crop.y).toBeCloseTo(0.4, 9);
    closeGeometry(flipGeometry(vertical, "vertical"), start);
  });

  it("reports the crop ratio in canvas pixels", () => {
    expect(cropPixelRatio(GEOMETRY, 3000, 2000)).toBeCloseTo(1.5, 9);
    expect(cropPixelRatio({ ...GEOMETRY, rotation: 1 }, 3000, 2000)).toBeCloseTo(2 / 3, 9);
    expect(cropPixelRatio({ ...GEOMETRY, crop: { x: 0, y: 0, width: 0.5, height: 1 } }, 3000, 2000)).toBeCloseTo(
      0.75,
      9,
    );
  });

  it("normalizes stored geometry", () => {
    expect(normalizeGeometry(undefined)).toEqual(GEOMETRY);
    expect(normalizeGeometry({ rotation: 7, angle: 90, flipH: 1, crop: { width: 0.5 } })).toEqual({
      ...GEOMETRY,
      rotation: 3,
      angle: 45,
    });
  });
});
