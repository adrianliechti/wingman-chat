import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import * as api from "./storeClient";

vi.mock("./storeClient", async (original) => ({
  ServerError: (await original<typeof import("./storeClient")>()).ServerError,
  listFiles: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
  deleteFile: vi.fn(),
}));

const memory = new MemoryOpfs();
const engines: { stop(): void }[] = [];
beforeEach(() => {
  memory.reset();
  vi.resetAllMocks();
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => memory.root },
    locks: {
      request: (name: string, options: unknown, callback?: () => Promise<unknown>) => {
        const fn = typeof options === "function" ? (options as () => Promise<unknown>) : callback!;
        if (typeof options === "object" && options && "mode" in options && options.mode === "shared") return fn();
        const result = (locks.get(name) ?? Promise.resolve()).then(fn, fn);
        locks.set(
          name,
          result.catch(() => {}),
        );
        return result;
      },
    },
  });
});
afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop();
});

it.each(["file", "directory"])(
  "retains another tab's baseline and propagates a later %s deletion",
  async (deletion) => {
    const remote = new Map<string, { data: Uint8Array; etag: string }>();
    vi.mocked(api.putFile).mockImplementation(async (id, data) => {
      const etag = crypto.randomUUID();
      remote.set(id, { data, etag });
      return etag;
    });
    vi.mocked(api.getFile).mockImplementation(async (id) => remote.get(id) ?? null);
    vi.mocked(api.deleteFile).mockImplementation(async (id) => {
      remote.delete(id);
    });
    vi.mocked(api.listFiles).mockImplementation(async () =>
      [...remote].map(([id, file]) => ({
        id,
        etag: file.etag,
        size: file.data.length,
        updated: "2026-01-01",
      })),
    );
    const { FileSync: FileSyncA } = await import("./fileSync");
    const opfsA = await import("./opfs-core");
    const { generateDEK } = await import("./crypto");
    const key = await generateDEK();
    const a = await FileSyncA.create({ userId: "alice", dek: key });
    engines.push(a);
    a.start();
    await a.fullSync();
    // Independent module state, as in a second tab sharing OPFS and Web Locks.
    vi.resetModules();
    const { FileSync: FileSyncB } = await import("./fileSync");
    const opfsB = await import("./opfs-core");
    const b = await FileSyncB.create({ userId: "alice", dek: key });
    engines.push(b);
    b.start();
    await b.fullSync();
    await opfsA.writeText("agents/a/AGENTS.md", "first tab");
    await a.flushDirty();
    await opfsB.writeText("agents/b/AGENTS.md", "second tab");
    await b.flushDirty();
    const state = await opfsA.readJson<{ entries: Record<string, unknown> }>("_sync/files.json");
    expect(Object.keys(state!.entries).sort()).toEqual(["agents/a/AGENTS.md", "agents/b/AGENTS.md"]);
    if (deletion === "directory") await opfsB.deleteDirectory("agents/a");
    else await opfsB.deleteFile("agents/a/AGENTS.md");
    await b.flushDirty();
    await b.fullSync();
    expect(await opfsB.readText("agents/a/AGENTS.md")).toBeUndefined();
    expect(remote.size).toBe(1);
  },
);
