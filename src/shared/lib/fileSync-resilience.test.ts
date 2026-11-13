import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileSync, type FileSyncActivity } from "./fileSync";
import { decryptFile, encryptFile, generateDEK } from "./crypto";
import { generateBackupKeys } from "./backupCrypto";
import { deleteFile, readBlob, readJson, readText, writeBlob, writeText } from "./opfs-core";
import * as api from "./storeClient";
import { MemoryOpfs } from "./test-support/memoryOpfs";

vi.mock("./storeClient", async (original) => ({
  ServerError: (await original<typeof import("./storeClient")>()).ServerError,
  listFiles: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
  deleteFile: vi.fn(),
}));

const memory = new MemoryOpfs();
const remote = new Map<string, { data: Uint8Array; etag: string }>();
let sync: FileSync | undefined;
let activity: FileSyncActivity;

async function idFor(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
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
  vi.mocked(api.putFile).mockImplementation(async (id, data, options) => {
    const current = remote.get(id);
    if ((options?.ifNoneMatch && current) || (options?.ifMatch && options.ifMatch !== current?.etag)) {
      throw new api.ServerError(412, "file conflict");
    }
    const etag = crypto.randomUUID();
    remote.set(id, { data, etag });
    return etag;
  });
  vi.mocked(api.deleteFile).mockImplementation(async (id, options) => {
    const current = remote.get(id);
    if (current && options?.ifMatch !== current.etag) throw new api.ServerError(412, "file conflict");
    remote.delete(id);
  });
});

afterEach(() => sync?.stop());

it("reports a listed but missing file as an incomplete restore and retries without losing healthy files", async () => {
  const key = await generateDEK();
  const paths = ["agents/healthy.md", "agents/missing.md"];
  for (const path of paths) {
    const id = await idFor(path);
    remote.set(id, {
      data: await encryptFile(key, { path, mtime: 2000 }, new TextEncoder().encode(path), "alice", id),
      etag: path,
    });
  }
  const missingId = await idFor(paths[1]);
  vi.mocked(api.getFile).mockImplementation(async (id) => (id === missingId ? null : (remote.get(id) ?? null)));
  sync = await FileSync.create({ userId: "alice", dek: key });
  sync.subscribeActivity((value) => (activity = value));

  await expect(sync.restore()).rejects.toThrow("could not be restored");
  expect(activity.lastError).toContain("could not be restored");
  expect(activity.syncing).toBe(false);
  expect(await readText(paths[0])).toBe(paths[0]);
  expect(await readText(paths[1])).toBeUndefined();
  expect(await readJson("_sync/files.json")).toMatchObject({ entries: { [paths[0]]: { id: await idFor(paths[0]) } } });
  expect(api.putFile).not.toHaveBeenCalled();

  vi.mocked(api.getFile).mockImplementation(async (id) => remote.get(id) ?? null);
  await sync.restore();
  expect(await readText(paths[1])).toBe(paths[1]);
  expect(activity.lastError).toBeNull();
  expect(activity.progress).toEqual([]);
});

it.each([
  { path: "agents/empty.txt", bytes: new Uint8Array() },
  { path: "agents/日本語 🦉.bin", bytes: new Uint8Array([0, 255, 128, 13, 10, 0, 42]) },
])("backs up and restores $path byte-for-byte on a fresh device", async ({ path, bytes }) => {
  const pair = await generateBackupKeys();
  const key = { ...(await generateDEK()), backup: { publicKey: pair.publicKey, privateKey: pair.privateKey } };
  await writeBlob(path, new Blob([bytes]));
  sync = await FileSync.create({ userId: "alice", dek: { kid: key.kid, backup: { publicKey: pair.publicKey } } });
  await sync.fullSync();
  const id = await idFor(path);
  expect(remote.size).toBe(1);
  const decoded = await decryptFile<{ path: string }>(key, remote.get(id)!.data, "alice", id);
  expect(decoded.header.path).toBe(path);
  expect(decoded.bytes).toEqual(bytes);

  memory.reset();
  sync = await FileSync.create({ userId: "alice", dek: key });
  await sync.restore();
  expect(new Uint8Array(await (await readBlob(path))!.arrayBuffer())).toEqual(bytes);
  expect(api.putFile).toHaveBeenCalledTimes(1);
});

it("retries a restore after local storage fills without marking the file as restored", async () => {
  const key = await generateDEK();
  const path = "agents/recovered.md";
  const id = await idFor(path);
  remote.set(id, {
    data: await encryptFile(key, { path, mtime: 2000 }, new TextEncoder().encode("complete"), "alice", id),
    etag: "remote",
  });
  memory.beforeWrite = async (writing) => {
    if (writing === path) throw new DOMException("Disk full", "QuotaExceededError");
  };
  sync = await FileSync.create({ userId: "alice", dek: key });
  await expect(sync.restore()).rejects.toThrow("could not be restored");
  expect(await readBlob(path)).toBeUndefined();
  expect(await readJson("_sync/files.json")).toMatchObject({ entries: {} });
  expect(api.putFile).not.toHaveBeenCalled();

  memory.beforeWrite = undefined;
  await sync.restore();
  expect(await readText(path)).toBe("complete");
  expect(await readJson("_sync/files.json")).toMatchObject({ entries: { [path]: { etag: "remote" } } });
});

it("keeps an edit made during upload pending until its own bytes reach the backup", async () => {
  const key = await generateDEK();
  const path = "agents/in-flight.md";
  sync = await FileSync.create({ userId: "alice", dek: key });
  sync.subscribeActivity((value) => (activity = value));
  sync.start();
  await sync.fullSync();
  await writeText(path, "first version");
  const put = vi.mocked(api.putFile).getMockImplementation()!;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(api.putFile).mockImplementationOnce(async (...args) => {
    await blocked;
    return put(...args);
  });
  const uploading = sync.flushDirty();
  try {
    await vi.waitFor(() => expect(api.putFile).toHaveBeenCalledOnce());
    await writeText(path, "edited during upload");
  } finally {
    release();
    await uploading;
  }
  expect(activity.pendingCount).toBe(1);
  await sync.flushDirty();
  expect(activity.pendingCount).toBe(0);
  const id = await idFor(path);
  const decoded = await decryptFile(key, remote.get(id)!.data, "alice", id);
  expect(new TextDecoder().decode(decoded.bytes)).toBe("edited during upload");
  expect(await readText(path)).toBe("edited during upload");
});

it.each([0, 1, 3])("resumes a multi-file backup after %s confirmed uploads and a restart", async (accepted) => {
  const key = await generateDEK();
  const paths = Array.from({ length: 5 }, (_, index) => `agents/file-${index}.md`);
  for (const path of paths) await writeText(path, `contents of ${path}`);
  const put = vi.mocked(api.putFile).getMockImplementation()!;
  vi.mocked(api.putFile).mockImplementation(async (...args) => {
    if (remote.size === accepted) throw new Error("connection reset mid-batch");
    return put(...args);
  });
  sync = await FileSync.create({ userId: "alice", dek: key });
  sync.subscribeActivity((value) => (activity = value));
  await sync.fullSync();
  expect(remote.size).toBe(accepted);
  expect(activity).toMatchObject({ syncing: false, progress: [], pendingCount: paths.length - accepted });
  const state = await readJson<{ entries: Record<string, unknown> }>("_sync/files.json");
  expect(Object.keys(state!.entries)).toHaveLength(accepted);

  vi.mocked(api.putFile).mockImplementation(put);
  sync.stop();
  sync = await FileSync.create({ userId: "alice", dek: key });
  await sync.fullSync();
  expect(remote.size).toBe(paths.length);
  // Confirmed paths are not needlessly uploaded again after restart.
  expect(api.putFile).toHaveBeenCalledTimes(paths.length + 1);
  memory.reset();
  sync = await FileSync.create({ userId: "alice", dek: key });
  await sync.restore();
  for (const path of paths) expect(await readText(path)).toBe(`contents of ${path}`);
});

it.each(["upload", "restore"])(
  "recovers when the local tracking write fails after a successful %s",
  async (direction) => {
    const key = await generateDEK();
    const path = "agents/checkpoint.md";
    const id = await idFor(path);
    if (direction === "upload") await writeText(path, "durable contents");
    else
      remote.set(id, {
        data: await encryptFile(key, { path, mtime: 2000 }, new TextEncoder().encode("durable contents"), "alice", id),
        etag: "original",
      });
    memory.beforeWrite = async (path) => {
      if (path === "_sync/files.json" && remote.has(id)) throw new DOMException("Disk full", "QuotaExceededError");
    };
    sync = await FileSync.create({ userId: "alice", dek: key });
    await expect(sync.fullSync()).rejects.toThrow("Disk full");
    expect(remote.size).toBe(1);
    expect(await readText(path)).toBe("durable contents");
    memory.beforeWrite = undefined;

    sync = await FileSync.create({ userId: "alice", dek: key });
    await sync.fullSync();
    expect(await readJson("_sync/files.json")).toMatchObject({ entries: { [path]: { id } } });
    expect(remote.size).toBe(1);
    memory.reset();
    sync = await FileSync.create({ userId: "alice", dek: key });
    await sync.restore();
    expect(await readText(path)).toBe("durable contents");
  },
);

it.each([false, true])(
  "retries an interrupted deletion after restart (server committed: %s) without resurrecting the file",
  async (committed) => {
    const key = await generateDEK();
    const path = "agents/deleted.md";
    await writeText(path, "remove me");
    sync = await FileSync.create({ userId: "alice", dek: key });
    await sync.fullSync();
    sync.start();
    await sync.fullSync();
    const remove = vi.mocked(api.deleteFile).getMockImplementation()!;
    vi.mocked(api.deleteFile).mockImplementationOnce(async (...args) => {
      if (committed) await remove(...args);
      throw new Error("deletion acknowledgement lost");
    });
    await deleteFile(path);
    await sync.flushDirty();
    expect(remote.size).toBe(committed ? 0 : 1);
    expect(await readJson("_sync/files.json")).toMatchObject({ entries: { [path]: expect.any(Object) } });
    sync.stop();

    sync = await FileSync.create({ userId: "alice", dek: key });
    await sync.fullSync();
    expect(remote.size).toBe(0);
    expect(await readText(path)).toBeUndefined();
    expect(await readJson("_sync/files.json")).toMatchObject({ entries: {} });
    memory.reset();
    sync = await FileSync.create({ userId: "alice", dek: key });
    await sync.restore();
    expect(await readText(path)).toBeUndefined();
    expect(api.putFile).toHaveBeenCalledOnce();
  },
);

it.each(["network", "truncated ciphertext", "local quota"])(
  "preserves the last good local file when an updated download fails due to %s",
  async (failure) => {
    const key = await generateDEK();
    const path = "agents/updated.md";
    const id = await idFor(path);
    await writeText(path, "last good version");
    sync = await FileSync.create({ userId: "alice", dek: key });
    await sync.fullSync();
    const baseline = await readJson("_sync/files.json");
    const ciphertext = await encryptFile(
      key,
      { path, mtime: 2000 },
      new TextEncoder().encode("complete remote update"),
      "alice",
      id,
    );
    remote.set(id, { data: ciphertext, etag: "updated" });
    if (failure === "network") vi.mocked(api.getFile).mockRejectedValue(new Error("download interrupted"));
    if (failure === "truncated ciphertext") remote.set(id, { data: ciphertext.slice(0, -8), etag: "updated" });
    if (failure === "local quota")
      memory.beforeWrite = async (writing) => {
        if (writing === path) throw new DOMException("Disk full", "QuotaExceededError");
      };
    await expect(sync.fullSync()).rejects.toThrow();
    expect(await readText(path)).toBe("last good version");
    expect(await readJson("_sync/files.json")).toEqual(baseline);
    expect(api.putFile).toHaveBeenCalledOnce();

    memory.beforeWrite = undefined;
    remote.set(id, { data: ciphertext, etag: "updated" });
    vi.mocked(api.getFile).mockImplementation(async (id) => remote.get(id) ?? null);
    sync = await FileSync.create({ userId: "alice", dek: key });
    await sync.fullSync();
    expect(await readText(path)).toBe("complete remote update");
    expect(await readJson("_sync/files.json")).toMatchObject({ entries: { [path]: { etag: "updated" } } });
    expect(api.putFile).toHaveBeenCalledOnce();
  },
);
