import { afterEach, beforeEach, expect, it, vi } from "vitest";

let classes: Set<string>;
let stored: Map<string, string>;
let load: ReturnType<typeof vi.fn<() => Promise<object[]>>>;
beforeEach(() => {
  vi.resetModules();
  classes = new Set();
  stored = new Map();
  load = vi.fn(() => Promise.resolve([{}]));
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal("document", {
    fonts: { load },
    documentElement: {
      classList: {
        add: (value: string) => classes.add(value),
        toggle: (value: string, enabled: boolean) => (enabled ? classes.add(value) : classes.delete(value)),
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it("does not wait for the font at startup, and shares concurrent loads", async () => {
  let resolve!: (fonts: object[]) => void;
  load.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const emoji = await import("./noto-emoji");
  expect(emoji.prepareInitialEmojiRendering()).toBeUndefined();
  const ready = emoji.ensureNotoEmojiReady();
  expect(emoji.ensureNotoEmojiReady()).toBe(ready);
  expect(load).toHaveBeenCalledTimes(1);
  expect(classes.has("noto-emoji-ready")).toBe(false);
  // A late load must not change a newer preference.
  emoji.applyEmojiModeClass("native");
  resolve([{}]);
  await ready;
  expect(classes).toEqual(new Set(["noto-emoji-ready", "emoji-native"]));
});

it("does not download the monochrome font in native mode", async () => {
  stored.set("app_emoji", "native");
  const emoji = await import("./noto-emoji");
  emoji.prepareInitialEmojiRendering();
  expect(load).not.toHaveBeenCalled();
  expect(classes).toEqual(new Set(["emoji-native"]));
});

it("keeps fallback rendering after a failure and allows retry", async () => {
  load.mockRejectedValueOnce(new Error("offline"));
  const emoji = await import("./noto-emoji");
  await emoji.ensureNotoEmojiReady();
  expect(classes.has("noto-emoji-ready")).toBe(false);
  await emoji.ensureNotoEmojiReady();
  expect(load).toHaveBeenCalledTimes(2);
  expect(classes.has("noto-emoji-ready")).toBe(true);
});

it("does not mark a missing font ready", async () => {
  load.mockResolvedValueOnce([]);
  const emoji = await import("./noto-emoji");
  await emoji.ensureNotoEmojiReady();
  expect(classes.has("noto-emoji-ready")).toBe(false);
});
