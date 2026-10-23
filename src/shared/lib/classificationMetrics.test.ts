// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { MeterProvider } from "@opentelemetry/sdk-metrics";
import { classificationMeter, flushClassificationMetrics, installClassificationMetrics } from "./classificationMetrics";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
});

it("starts immediately, serializes overlapping flushes, and flushes new observations afterward", async () => {
  const completions: (() => void)[] = [];
  const forceFlush = vi.fn(() => new Promise<void>((resolve) => completions.push(resolve)));
  dispose = installClassificationMetrics({ forceFlush } as unknown as MeterProvider);
  flushClassificationMetrics();
  expect(forceFlush).toHaveBeenCalledTimes(1);
  flushClassificationMetrics();
  flushClassificationMetrics();
  expect(forceFlush).toHaveBeenCalledTimes(1);
  completions.shift()!();
  await vi.waitFor(() => expect(forceFlush).toHaveBeenCalledTimes(2));
  completions.shift()!();
  await Promise.resolve();
  await Promise.resolve();
  expect(forceFlush).toHaveBeenCalledTimes(2);
});

it("flushes when hidden and removes its listener on shutdown", async () => {
  const forceFlush = vi.fn().mockResolvedValue(undefined);
  const getMeter = vi.fn().mockReturnValue("classification meter");
  dispose = installClassificationMetrics({ forceFlush, getMeter } as unknown as MeterProvider);
  expect(classificationMeter()).toBe("classification meter");
  expect(getMeter).toHaveBeenCalledWith("wingman");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(forceFlush).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  dispose();
  document.dispatchEvent(new Event("visibilitychange"));
  flushClassificationMetrics();
  expect(forceFlush).toHaveBeenCalledTimes(1);
  expect(classificationMeter()).toBeUndefined();
});

it("handles exporter failure without unhandled rejection or blocking subsequent flushes", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const forceFlush = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  dispose = installClassificationMetrics({ forceFlush } as unknown as MeterProvider);
  flushClassificationMetrics();
  flushClassificationMetrics();
  await vi.waitFor(() => expect(forceFlush).toHaveBeenCalledTimes(2));
  expect(console.warn).toHaveBeenCalledTimes(1);
});
