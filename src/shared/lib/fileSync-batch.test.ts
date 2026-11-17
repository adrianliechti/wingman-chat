import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileSync, type FileSyncActivity } from "./fileSync";
import { decryptFile } from "./crypto";
import { readJson, readText, writeBlob, writeText } from "./opfs-core";
import * as api from "./storeClient";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import { generateStoreKey } from "./test-support/storeKey";

vi.mock("./storeClient", async (original) => ({
  ServerError: (await original<typeof import("./storeClient")>()).ServerError,
  listFiles: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
  putFiles: vi.fn(),
  deleteFile: vi.fn(),
}));

const memory = new MemoryOpfs();
const remote = new Map<string, { data: Uint8Array; etag: string }>();
let sync: FileSync | undefined;
let activity: FileSyncActivity;

function precondition(id: string, options: { ifMatch?: string; ifNoneMatch?: "*" }): boolean {
  const current = remote.get(id);
  return !((options.ifNoneMatch && current) || (options.ifMatch && options.ifMatch !== current?.etag));
}

beforeEach(() => {
  vi.resetAllMocks();
  memory.reset();
  remote.clear();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  vi.mocked(api.listFiles).mockImplementation(async () =>
    [...remote].map(([id, file]) => ({ id, etag: file.etag, size: file.data.length, updated: "2026-01-01" })),
  );
  vi.mocked(api.getFile).mockImplementation(async (id) => remote.get(id) ?? null);
  vi.mocked(api.putFile).mockImplementation(async (id, data, options = {}) => {
    if (!precondition(id, options)) throw new api.ServerError(412, "file conflict");
    const etag = crypto.randomUUID();
    remote.set(id, { data, etag });
    return etag;
  });
  vi.mocked(api.putFiles).mockImplementation(async (files) => {
    if (!files.every((file) => precondition(file.id, file))) throw new api.ServerError(412, "file conflict");
    return files.map((file) => {
      const etag = crypto.randomUUID();
      remote.set(file.id, { data: file.data, etag });
      return etag;
    });
  });
});

afterEach(() => sync?.stop());

async function start(): Promise<FileSync> {
  sync?.stop();
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  sync.subscribeActivity((value) => (activity = value));
  return sync;
}

let key: Awaited<ReturnType<typeof generateStoreKey>>;
beforeEach(async () => {
  key = await generateStoreKey();
});

it("uploads an initial backup in batches and restores it intact", async () => {
  const paths = Array.from({ length: 120 }, (_, index) => `agents/file-${index}.md`);
  for (const path of paths) await writeText(path, `contents of ${path}`);
  await (await start()).fullSync();

  expect(vi.mocked(api.putFiles).mock.calls.map(([files]) => files.length)).toEqual([50, 50, 20]);
  expect(api.putFile).not.toHaveBeenCalled();
  expect(remote.size).toBe(paths.length);
  expect(activity).toMatchObject({ pendingCount: 0, lastError: null, progress: [] });
  const state = await readJson<{ entries: Record<string, unknown> }>("_sync/files.json");
  expect(Object.keys(state!.entries)).toHaveLength(paths.length);

  // A restart neither re-uploads nor re-downloads anything.
  vi.mocked(api.putFiles).mockClear();
  await (await start()).fullSync();
  expect(api.putFiles).not.toHaveBeenCalled();
  expect(api.getFile).not.toHaveBeenCalled();

  memory.reset();
  await (await start()).fullSync();
  for (const path of paths) expect(await readText(path)).toBe(`contents of ${path}`);
});

it("uploads large files individually alongside a batch", async () => {
  await writeText("agents/a.md", "a");
  await writeText("agents/b.md", "b");
  await writeBlob("images/large.bin", new Blob([new Uint8Array(5 * 1024 * 1024)]));
  await (await start()).fullSync();

  expect(api.putFiles).toHaveBeenCalledOnce();
  expect(vi.mocked(api.putFiles).mock.calls[0][0]).toHaveLength(2);
  expect(api.putFile).toHaveBeenCalledOnce();
  expect(remote.size).toBe(3);
});

it("falls back to per-file uploads when a batch conflicts, keeping the newer edit", async () => {
  const paths = ["agents/a.md", "agents/b.md", "agents/c.md"];
  for (const path of paths) await writeText(path, `local ${path}`);
  const s = await start();
  // Another device created b.md with an older edit after this device listed the backup.
  vi.mocked(api.putFiles).mockImplementationOnce(async (files) => {
    const { encryptFile } = await import("./crypto");
    const id = files[1].id;
    remote.set(id, {
      data: await encryptFile(key, { path: paths[1], mtime: 1 }, new TextEncoder().encode("remote"), "alice", id),
      etag: "other-device",
    });
    throw new api.ServerError(412, "file conflict");
  });
  await s.fullSync();

  expect(api.putFile).toHaveBeenCalledTimes(paths.length + 1);
  expect(activity).toMatchObject({ pendingCount: 0, lastError: null });
  for (const [id, file] of remote) {
    const { header, bytes } = await decryptFile<{ path: string }>(key, file.data, "alice", id);
    expect(new TextDecoder().decode(bytes)).toBe(`local ${header.path}`);
  }
});

it("stops batching against a server without batch uploads", async () => {
  vi.mocked(api.putFiles).mockRejectedValue(new api.ServerError(405, "method not allowed"));
  const s = await start();
  s.start();
  await s.fullSync();
  await writeText("agents/a.md", "a");
  await writeText("agents/b.md", "b");
  await s.flushDirty();
  await writeText("agents/c.md", "c");
  await writeText("agents/d.md", "d");
  await s.flushDirty();

  expect(api.putFiles).toHaveBeenCalledOnce();
  expect(api.putFile).toHaveBeenCalledTimes(4);
  expect(remote.size).toBe(4);
});
