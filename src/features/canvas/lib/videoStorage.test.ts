import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Image } from "../types/canvas";
import { loadImage, removeImage, storeImage } from "./imageStorage";
import { DEFAULTS } from "./recipe";

const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/shared/lib/persistence", () => ({ withPersistenceLock: (_key: string, run: () => unknown) => run() }));
vi.mock("@/shared/lib/opfs", () => ({
  readJson: async (path: string) => memory.get(path),
  writeJson: async (path: string, value: unknown) => {
    memory.set(path, JSON.parse(JSON.stringify(value)));
  },
  readBlob: async (path: string) => memory.get(path),
  writeBlob: async (path: string, value: Blob) => {
    memory.set(path, value);
  },
  deleteFile: async (path: string) => {
    memory.delete(path);
  },
  deleteDirectory: async (path: string) => {
    for (const key of memory.keys()) if (key.startsWith(`${path}/`)) memory.delete(key);
  },
  upsertIndexEntry: async () => {},
  removeIndexEntry: async () => {},
  isDataUrl: (data: string) => data.startsWith("data:"),
  dataUrlToBlob: () => new Blob(["poster"], { type: "image/jpeg" }),
  blobToDataUrl: async (blob: Blob, type: string) => `data:${type};base64,${btoa(await blob.text())}`,
}));

beforeEach(() => memory.clear());
describe("Canvas video persistence", () => {
  it("reloads video bytes, MIME type, dimensions, duration and a separate poster", async () => {
    const video: Image = {
      id: "clip",
      model: "gemini-omni-1.2-flash",
      prompt: "A fox",
      created: new Date("2026-11-08"),
      updated: null,
      data: "data:image/jpeg;base64,cG9zdGVy",
      blob: new Blob(["mp4-video-bytes"], { type: "video/mp4" }),
      contentType: "video/mp4",
      width: 1280,
      height: 720,
      duration: 15,
      versions: [{ id: "version1", kind: "generated", created: "2026-11-08" }],
      recipe: DEFAULTS,
    };
    await storeImage(video);
    const loaded = await loadImage(video.id);
    expect(loaded).toMatchObject({
      contentType: "video/mp4",
      width: 1280,
      height: 720,
      duration: 15,
      model: video.model,
      data: video.data,
      versions: video.versions,
    });
    expect(loaded?.blob?.type).toBe("video/mp4");
    expect(await loaded?.blob?.text()).toBe("mp4-video-bytes");
    await storeImage({ ...loaded!, title: "Renamed clip" });
    expect(await (await loadImage(video.id))?.blob?.text()).toBe("mp4-video-bytes");
    await removeImage(video.id);
    expect(await loadImage(video.id)).toBeUndefined();
  });
});
