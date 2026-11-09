import { expect, test } from "@playwright/test";
import type {} from "./fixtures/canvas";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/canvas.html");
  await page.waitForFunction(() => !!window.canvasE2E);
});

test("neutral rendering, compare and exposure preserve pixels and orientation", async ({ page }) => {
  const result = await page.evaluate(() => {
    const input = new ImageData(16, 16);
    for (let i = 0; i < 256; i++) input.data.set([i, (i * 17) % 256, 255 - i, 255], i * 4);
    const render = window.canvasE2E.renderer(input);
    const neutral = render.draw().data;
    const compare = render.draw({ exposure: 3, clarity: 80, dehaze: 60, vignette: -90 }, { original: true }).data;
    const maxError = (data: Uint8ClampedArray) => Math.max(...data.map((value, i) => Math.abs(value - input.data[i])));
    render.destroy();
    const gray = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
    const exposure = window.canvasE2E.renderer(gray);
    const bright = exposure.draw({ exposure: 1 }).data[0];
    exposure.destroy();
    return { neutral: maxError(neutral), compare: maxError(compare), bright };
  });
  expect(result.neutral).toBeLessThanOrEqual(1);
  expect(result.compare).toBeLessThanOrEqual(1);
  expect(result.bright).toBeGreaterThanOrEqual(175);
  expect(result.bright).toBeLessThanOrEqual(176);
});

test("tone ramps stay monotonic at individual and combined slider extremes", async ({ page }) => {
  const failures = await page.evaluate(() => {
    const input = new ImageData(256, 1);
    for (let i = 0; i < 256; i++) input.data.set([i, i, i, 255], i * 4);
    const render = window.canvasE2E.renderer(input);
    const failures: unknown[] = [];
    const keys = ["shadows", "highlights", "whites", "blacks"] as const;
    const cases = keys.flatMap((key) => [-100, 100].map((value) => ({ [key]: value })));
    for (let mask = 0; mask < 16; mask++)
      cases.push(Object.fromEntries(keys.map((key, i) => [key, mask & (1 << i) ? 100 : -100])));
    for (const patch of cases)
      for (const contrast of [-100, 0, 100]) {
        const pixels = render.draw({ ...patch, contrast }).data;
        for (let x = 1; x < 256; x++) {
          if (pixels[x * 4] < pixels[(x - 1) * 4]) {
            failures.push({ patch, contrast, x, previous: pixels[(x - 1) * 4], value: pixels[x * 4] });
            break;
          }
        }
      }
    render.destroy();
    return failures;
  });
  expect(failures).toEqual([]);
});

test("clarity leaves flat color and transparency unchanged and adjusts texture", async ({ page }) => {
  const result = await page.evaluate(() => {
    const input = new ImageData(256, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 256; x++) {
        const alpha = x < 64 ? 0 : x < 128 ? 128 : 255;
        input.data.set(alpha ? [190, 110, 65, alpha] : [0, 255, 0, 0], (y * 256 + x) * 4);
      }
    const render = window.canvasE2E.renderer(input);
    const neutral = render.draw().data;
    let flatError = 0;
    let alphaError = 0;
    for (const clarity of [-100, 100]) {
      const pixels = render.draw({ clarity }).data;
      for (let i = 0; i < pixels.length; i += 4) {
        alphaError = Math.max(alphaError, Math.abs(pixels[i + 3] - input.data[i + 3]));
        if (!input.data[i + 3]) continue;
        for (let c = 0; c < 3; c++) flatError = Math.max(flatError, Math.abs(pixels[i + c] - neutral[i + c]));
      }
    }
    render.destroy();
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 256; x++) {
        const v = Math.round(128 + 12 * Math.sin((x * Math.PI) / 8));
        input.data.set([v, v, v, 255], (y * 256 + x) * 4);
      }
    const texture = window.canvasE2E.renderer(input);
    const contrast = [-100, 0, 100].map((clarity) => {
      const pixels = texture.draw({ clarity }).data;
      let variance = 0;
      for (let x = 32; x < 224; x++) variance += (pixels[(64 * 256 + x) * 4] - 128) ** 2;
      return variance / 192;
    });
    texture.destroy();
    return { flatError, alphaError, contrast };
  });
  expect(result.flatError).toBeLessThanOrEqual(1);
  expect(result.alphaError).toBe(0);
  expect(result.contrast[0]).toBeLessThan(result.contrast[1] * 0.9);
  expect(result.contrast[2]).toBeGreaterThan(result.contrast[1] * 1.1);
});

test("rotation interpolates transparent edges consistently with compare", async ({ page }) => {
  const result = await page.evaluate(() => {
    const input = new ImageData(128, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        input.data.set(x < 64 ? [255, 0, 0, 0] : [100, 180, 220, 255], (y * 128 + x) * 4);
      }
    const render = window.canvasE2E.renderer(input);
    const recipe = { geometry: { ...window.canvasE2E.DEFAULTS.geometry, angle: 17 } };
    const developed = render.draw(recipe).data;
    const original = render.draw(recipe, { original: true }).data;
    let compareError = 0;
    let fringeError = 0;
    for (let i = 0; i < developed.length; i += 4) {
      if (developed[i + 3] < 10) continue;
      for (let c = 0; c < 3; c++) {
        compareError = Math.max(compareError, Math.abs(developed[i + c] - original[i + c]));
        fringeError = Math.max(fringeError, Math.abs(developed[i + c] - [100, 180, 220][c]));
      }
    }
    render.destroy();
    return { compareError, fringeError };
  });
  expect(result.compareError).toBeLessThanOrEqual(2);
  expect(result.fringeError).toBeLessThanOrEqual(2);
});

test("floating intermediates retain bright detail until the final vignette", async ({ page }) => {
  const result = await page.evaluate(() => {
    const input = new ImageData(128, 128);
    for (let i = 0; i < input.data.length; i += 4) input.data.set([254, 254, 254, 255], i);
    const render = window.canvasE2E.renderer(input);
    const pixels = render.draw({ exposure: 1, vignette: -100 }).data;
    const result = { floating: render.floating, corner: pixels[0], center: pixels[(64 * 128 + 64) * 4] };
    render.destroy();
    return result;
  });
  expect(result.floating).toBe(true);
  expect(result.corner).toBeGreaterThanOrEqual(186);
  expect(result.corner).toBeLessThanOrEqual(188);
  expect(result.center).toBe(255);
});

test("PNG export retains translucent color and JPEG flattens onto white", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = new OffscreenCanvas(32, 16);
    const context = source.getContext("2d")!;
    context.fillStyle = "rgba(200, 100, 50, 0.5)";
    context.fillRect(0, 0, 16, 16);
    const original = Array.from(context.getImageData(8, 8, 1, 1).data);
    const blob = await source.convertToBlob({ type: "image/png" });
    const samples = [];
    for (const format of ["png", "jpeg"] as const) {
      const output = await window.canvasE2E.renderExport(blob, window.canvasE2E.DEFAULTS, format);
      const bitmap = await createImageBitmap(output);
      context.clearRect(0, 0, 32, 16);
      context.drawImage(bitmap, 0, 0);
      samples.push({
        type: output.type,
        color: Array.from(context.getImageData(8, 8, 1, 1).data),
        empty: Array.from(context.getImageData(24, 8, 1, 1).data),
      });
      bitmap.close();
    }
    return { original, samples };
  });
  expect(result.samples[0].type).toBe("image/png");
  for (let c = 0; c < 4; c++)
    expect(Math.abs(result.samples[0].color[c] - result.original[c]), JSON.stringify(result)).toBeLessThanOrEqual(2);
  expect(result.samples[0].empty[3]).toBe(0);
  expect(result.samples[1].type).toBe("image/jpeg");
  for (let c = 0; c < 3; c++) {
    const expected = 255 + ((result.original[c] - 255) * result.original[3]) / 255;
    expect(Math.abs(result.samples[1].color[c] - expected)).toBeLessThanOrEqual(3);
    expect(result.samples[1].empty[c]).toBeGreaterThanOrEqual(253);
  }
  expect(result.samples[1].color[3]).toBe(255);
});

test("the RGBA8 fallback still renders neutral colors and clarity", async ({ page }) => {
  const result = await page.evaluate(() => {
    const input = new ImageData(64, 64);
    for (let i = 0; i < input.data.length; i += 4) input.data.set([160, 120, 80, 255], i);
    const render = window.canvasE2E.renderer(input, false);
    const color = Array.from(render.draw({ clarity: 100 }).data.slice(0, 4));
    render.destroy();
    return color;
  });
  for (let c = 0; c < 4; c++) expect(Math.abs(result[c] - [160, 120, 80, 255][c])).toBeLessThanOrEqual(1);
});

test("color adjustments keep neutrals neutral, preserve luminance and move the intended hues", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.canvasE2E;
    const input = new ImageData(new Uint8ClampedArray([180, 80, 40, 255, 128, 128, 128, 255, 40, 80, 180, 255]), 3, 1);
    const render = api.renderer(input);
    const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luma = (rgb: ArrayLike<number>) =>
      [0.2126, 0.7152, 0.0722].reduce((sum, weight, c) => sum + decode(rgb[c] / 255) * weight, 0);
    const originalLuma = luma(input.data);
    const saturation = render.draw({ saturation: 100 }).data;
    const gray = render.draw({ grayscale: true }).data;
    const temperature = [-100, 100].map((temperature) => Array.from(render.draw({ temperature }).data.slice(4, 7)));
    const mixer = api.DEFAULTS.mixer.map((band, i) => ({ ...band, hue: i < 2 ? 60 : 0 }));
    const mixed = Array.from(render.draw({ mixer }).data);
    const desaturated = Array.from(render.draw({ saturation: -100 }).data);
    const saturationLuma = luma(saturation);
    const grayLuma = luma(gray);
    render.destroy();
    return { originalLuma, saturationLuma, grayLuma, temperature, mixed, desaturated };
  });
  expect(Math.abs(result.saturationLuma - result.originalLuma)).toBeLessThan(0.003);
  expect(Math.abs(result.grayLuma - result.originalLuma)).toBeLessThan(0.003);
  expect(result.temperature[0][2]).toBeGreaterThan(result.temperature[0][0]);
  expect(result.temperature[1][0]).toBeGreaterThan(result.temperature[1][2]);
  expect(result.mixed.slice(4, 7)).toEqual([128, 128, 128]);
  expect(result.mixed.slice(8, 11)).toEqual([40, 80, 180]);
  expect(result.mixed[1]).toBeGreaterThan(80);
  for (let i = 0; i < 12; i += 4)
    expect(result.desaturated.slice(i, i + 3)).toEqual(Array(3).fill(result.desaturated[i]));
});

test("clarity has a smooth edge response and agrees between preview and export sizes", async ({ page }) => {
  const result = await page.evaluate(() => {
    const size = 1536;
    const source = new ImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = Math.round(128 + 24 * Math.sin((x * Math.PI) / 64) + 16 * Math.sin((y * Math.PI) / 96));
        source.data.set([v + 30, v, v - 20, 255], (y * size + x) * 4);
      }
    const resize = (data: ImageData) => {
      const full = new OffscreenCanvas(data.width, data.height);
      full.getContext("2d")!.putImageData(data, 0, 0);
      const small = new OffscreenCanvas(size / 2, size / 2);
      const context = small.getContext("2d")!;
      context.imageSmoothingQuality = "high";
      context.drawImage(full, 0, 0, size / 2, size / 2);
      return context.getImageData(0, 0, size / 2, size / 2);
    };
    const full = window.canvasE2E.renderer(source);
    const small = window.canvasE2E.renderer(resize(source));
    let maxError = 0;
    let total = 0;
    for (const clarity of [-100, 100]) {
      const expected = resize(full.draw({ clarity })).data;
      const preview = small.draw({ clarity }).data;
      for (let i = 0; i < preview.length; i += 4)
        for (let c = 0; c < 3; c++) {
          const error = Math.abs(preview[i + c] - expected[i + c]);
          total += error;
          maxError = Math.max(maxError, error);
        }
    }
    full.destroy();
    small.destroy();

    // The response to a small step must decay smoothly away from the edge,
    // without the repeated bands produced by widely spaced Gaussian taps.
    const step = new ImageData(1024, 512);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 1024; x++) {
        const v = x < 512 ? 115 : 140;
        step.data.set([v, v, v, 255], (y * 1024 + x) * 4);
      }
    const edge = window.canvasE2E.renderer(step);
    const pixels = edge.draw({ clarity: 100 }).data;
    const profile = Array.from({ length: 40 }, (_, x) => pixels[(256 * 1024 + 512 + x) * 4]);
    edge.destroy();
    return { maxError, meanError: total / (2 * 3 * (size / 2) ** 2), profile };
  });
  expect(result.meanError).toBeLessThan(1);
  expect(result.maxError).toBeLessThanOrEqual(4);
  expect(result.profile[0]).toBeGreaterThan(140);
  expect(result.profile.at(-1)).toBe(140);
  for (let i = 1; i < result.profile.length; i++)
    expect(result.profile[i]).toBeLessThanOrEqual(result.profile[i - 1] + 1);
});

test("profiled PNG colors agree with the browser's sRGB conversion", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = new OffscreenCanvas(16, 16);
    const context = source.getContext("2d", { colorSpace: "display-p3" })!;
    context.fillStyle = "color(display-p3 0.8 0.4 0.2)";
    context.fillRect(0, 0, 16, 16);
    const blob = await source.convertToBlob();
    const srgb = new OffscreenCanvas(16, 16).getContext("2d", { colorSpace: "srgb" })!;
    const original = await createImageBitmap(blob);
    srgb.drawImage(original, 0, 0);
    const expected = Array.from(srgb.getImageData(0, 0, 1, 1).data);
    original.close();
    const output = await createImageBitmap(await window.canvasE2E.renderExport(blob, window.canvasE2E.DEFAULTS, "png"));
    srgb.drawImage(output, 0, 0);
    const actual = Array.from(srgb.getImageData(0, 0, 1, 1).data);
    output.close();
    return { expected, actual };
  });
  for (let c = 0; c < 4; c++) expect(Math.abs(result.actual[c] - result.expected[c])).toBeLessThanOrEqual(2);
});

test("WebP export returns WebP bytes or an explicit unsupported-format error", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(16, 16);
    canvas.getContext("2d");
    const source = await canvas.convertToBlob();
    try {
      const blob = await window.canvasE2E.renderExport(source, window.canvasE2E.DEFAULTS, "webp");
      return blob.type;
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(["image/webp", "This browser cannot export WEBP. Choose PNG or JPEG."]).toContain(result);
});
