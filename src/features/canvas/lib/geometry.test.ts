import { describe, expect, it } from "vitest";
import {
  applyMatrix,
  fitAspect,
  FULL_CROP,
  GEOMETRY,
  largestCrop,
  normalizeGeometry,
  outputSize,
  sourceMatrix,
} from "./geometry";

const close = (actual: [number, number], expected: [number, number]) => {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
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

  it("normalizes stored geometry", () => {
    expect(normalizeGeometry(undefined)).toEqual(GEOMETRY);
    expect(normalizeGeometry({ rotation: 7, angle: 90, flipH: 1, crop: { width: 0.5 } })).toEqual({
      ...GEOMETRY,
      rotation: 3,
      angle: 45,
    });
  });
});
