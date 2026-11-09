import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileSync, type FileSyncActivity } from "./fileSync";
import { decryptFile, encryptFile, generateDEK } from "./crypto";
import { deleteDirectory, deleteFile, readText, writeJson, writeText } from "./opfs-core";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import * as api from "./storeClient";

vi.mock("./storeClient", async (importOriginal) => ({
  ServerError: (await importOriginal<typeof import("./storeClient")>()).ServerError,
  listFiles: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
  deleteFile: vi.fn(),
}));

const memory = new MemoryOpfs();
/** Remote files are addressed by the SHA-256 of their path. */
async function idFor(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
let sync: FileSync | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  vi.mocked(api.listFiles).mockResolvedValue([]);
  vi.mocked(api.putFile).mockResolvedValue("etag");
});
afterEach(() => sync?.stop());

it("does not restore an unknown remote file after its directory is deleted during download", async () => {
  const key = await generateDEK();
  const path = "agents/one/remote.md";
  const id = await idFor(path);
  memory.put("agents/one/local.md", "local");
  const data = await encryptFile(key, { path, mtime: 2000 }, new TextEncoder().encode("remote"), "alice", id);
  vi.mocked(api.listFiles).mockResolvedValue([{ id, etag: "remote", updated: "2026-01-01", size: data.length }]);
  let release!: (value: { etag: string; data: Uint8Array }) => void;
  vi.mocked(api.getFile).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  sync = await FileSync.create({ userId: "alice", dek: key });
  sync.start();
  await vi.waitFor(() => expect(release).toBeDefined());
  await deleteDirectory("agents/one");
  release({ etag: "remote", data });
  await sync.fullSync();
  expect(await readText(path)).toBeUndefined();
});

it.each(["update", "deletion"])("preserves a local edit made while a remote %s is being listed", async (kind) => {
  const key = await generateDEK();
  const path = "agents/one/AGENTS.md";
  const id = await idFor(path);
  memory.put(path, "old");
  await writeJson("_sync/files.json", { userId: "alice", entries: { [path]: { id, etag: "old", mtime: 1000 } } });
  let release!: (value: api.ServerFileMeta[]) => void;
  vi.mocked(api.listFiles).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  vi.mocked(api.getFile).mockResolvedValue({
    etag: "remote",
    data: await encryptFile(key, { path, mtime: 2000 }, new TextEncoder().encode("remote"), "alice", id),
  });
  sync = await FileSync.create({ userId: "alice", dek: key });
  sync.start();
  await vi.waitFor(() => expect(release).toBeDefined());
  await writeText(path, "local edit");
  release(kind === "update" ? [{ id, etag: "remote", updated: "2026-01-01T00:00:00Z", size: 1 }] : []);
  await sync.fullSync();
  expect(await readText(path)).toBe("local edit");
  expect(api.putFile).toHaveBeenCalled();
});

it("backs up current artifact bytes, saved app data, and other collections without chat internals or revisions", async () => {
  const key = await generateDEK();
  const paths = [
    "chats/one/artifacts/nested/report.html",
    "chats/one/artifacts/chart.png",
    "chats/two/artifact-state/%2Freport.html.json",
    "projects/one/project.json",
    "projects/one/files/original",
    "drafts/chat-one/draft.json",
    "drafts/chat-one/files/upload",
    "agents/one/AGENTS.md",
    "agents/one/files/source/embeddings.bin",
    "agents/one/memory/notes.md",
    "agents/one/memory-state.json",
    "skills/custom/SKILL.md",
    "plugins/one/plugin.json",
    "plugins/one/skills/custom/SKILL.md",
    "repositories/one/files/source/content.txt",
    "images/one/image.png",
    "profile.json",
  ];
  const excluded = [
    "chats/index.json",
    "chats/one/chat.json",
    "chats/one/chat.legacy.json",
    "chats/one/history.jsonl",
    "chats/one/target.json",
    "chats/one/blobs/attachment.bin",
    "chats/one/artifact-versions/report/revision.json",
    "chats/one/artifact-versions/report/history.json",
    "_sync/upload-key.json",
  ];
  for (const path of [...paths, ...excluded]) memory.put(path, `bytes:${path}`);
  sync = await FileSync.create({ userId: "alice", dek: key });
  await sync.fullSync();
  const uploaded = await Promise.all(
    vi.mocked(api.putFile).mock.calls.map(async ([id, cipher]) => {
      const { header, bytes } = await decryptFile<{ path: string }>(key, cipher, "alice", id);
      expect(new TextDecoder().decode(bytes)).toBe(`bytes:${header.path}`);
      return header.path;
    }),
  );
  expect(uploaded.sort()).toEqual(paths.sort());
});

it("restores artifacts and saved app data on a fresh browser while refusing revision history and chat manifests", async () => {
  const key = await generateDEK();
  const paths = [
    "chats/one/artifacts/nested/report.html",
    "chats/one/artifact-state/%2Freport.html.json",
    "chats/one/artifact-versions/report/revision.json",
    "chats/one/chat.json",
  ];
  const remote = await Promise.all(
    paths.map(async (path) => {
      const id = await idFor(path);
      const data = await encryptFile(key, { path, mtime: 2000 }, new TextEncoder().encode(path), "alice", id);
      return { id, data, etag: "remote", size: data.length, updated: "2026-11-02T00:00:00Z" };
    }),
  );
  vi.mocked(api.listFiles).mockResolvedValue(remote);
  vi.mocked(api.getFile).mockImplementation(async (id) => remote.find((file) => file.id === id) ?? null);
  sync = await FileSync.create({ userId: "alice", dek: key });
  const activity: FileSyncActivity[] = [];
  sync.subscribeActivity((value) => activity.push(value));
  await sync.fullSync();
  for (const path of paths.slice(0, 2)) expect(await readText(path)).toBe(path);
  for (const path of paths.slice(2)) expect(await readText(path)).toBeUndefined();
  expect(api.putFile).not.toHaveBeenCalled();
  expect(
    activity.some((a) => a.progress.some((p) => p.direction === "restore" && p.total === 4 && p.completed === 1)),
  ).toBe(true);
  expect(activity.at(-1)).toMatchObject({ syncing: false, progress: [] });
});

it("tracks artifact edits and file/folder/chat deletions through OPFS mutations", async () => {
  const key = await generateDEK();
  sync = await FileSync.create({ userId: "alice", dek: key });
  sync.start();
  await sync.fullSync();
  const file = "chats/one/artifacts/report.txt";
  await writeText(file, "final artifact");
  await writeText("chats/one/artifact-versions/report/revision.json", "local history");
  await sync.flushDirty();
  expect(api.putFile).toHaveBeenCalledOnce();
  const id = vi.mocked(api.putFile).mock.calls[0][0];
  await writeText(file, "edited artifact");
  await sync.flushDirty();
  expect(api.putFile).toHaveBeenCalledTimes(2);
  await deleteFile(file);
  await sync.flushDirty();
  expect(api.deleteFile).toHaveBeenCalledWith(id, { ifMatch: "etag" });

  for (const [folder, path] of [
    ["chats/one/artifacts/nested", "chats/one/artifacts/nested/data.txt"],
    ["chats/one", "chats/one/artifacts/data.txt"],
  ]) {
    await writeText(path, "data");
    await sync.flushDirty();
    const latestId = vi.mocked(api.putFile).mock.calls.at(-1)![0];
    await deleteDirectory(folder);
    await sync.flushDirty();
    expect(api.deleteFile).toHaveBeenCalledWith(latestId, { ifMatch: "etag" });
  }
});

it("uploads binary artifacts with a public upload key and applies remote deletion after unlock", async () => {
  const { generateBackupKeys } = await import("./backupCrypto");
  const pair = await generateBackupKeys();
  const path = "chats/one/artifacts/nested/data.bin";
  const bytes = new Uint8Array([0, 255, 128, 1]);
  memory.put(path, new Blob([bytes]));
  sync = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  await sync.fullSync();
  expect(api.listFiles).not.toHaveBeenCalled();
  const [id, cipher] = vi.mocked(api.putFile).mock.calls[0];
  const key = { ...(await generateDEK()), backup: pair };
  expect((await decryptFile(key, cipher, "alice", id)).bytes).toEqual(bytes);
  sync.setKey(key);
  await sync.fullSync();
  expect(await readText(path)).toBeUndefined();
  expect(api.putFile).toHaveBeenCalledOnce();
});

it("keeps nested directory version markers out of the file upload queue", async () => {
  const key = await generateDEK();
  memory.put("agents/one/AGENTS.md", "agent");
  sync = await FileSync.create({ userId: "alice", dek: key });
  sync.start();
  await sync.fullSync();
  await deleteDirectory("agents/one");
  await sync.flushDirty();
  await deleteDirectory("agents");
  await sync.flushDirty();
  let lastError: string | null = null;
  sync.subscribeActivity((activity) => {
    lastError = activity.lastError;
  });
  expect(lastError).toBeNull();
});

it("reports a corrupt remote file as an incomplete restore and retries it", async () => {
  const key = await generateDEK();
  const path = "agents/one/AGENTS.md";
  const id = await idFor(path);
  vi.mocked(api.listFiles).mockResolvedValue([{ id, etag: "remote", updated: "2026-01-01", size: 3 }]);
  vi.mocked(api.getFile).mockResolvedValue({ etag: "remote", data: new Uint8Array([1, 2, 3]) });
  sync = await FileSync.create({ userId: "alice", dek: key });
  await expect(sync.fullSync()).rejects.toThrow("1 backup file could not be restored");
  let lastError: string | null = null;
  sync.subscribeActivity((activity) => {
    lastError = activity.lastError;
  });
  expect(lastError).toContain("could not be restored");
  expect(await readText(path)).toBeUndefined();
  vi.mocked(api.getFile).mockResolvedValue({
    etag: "remote",
    data: await encryptFile(key, { path, mtime: 2000 }, new TextEncoder().encode("recovered"), "alice", id),
  });
  await sync.fullSync();
  expect(await readText(path)).toBe("recovered");
  expect(lastError).toBeNull();
});

it("reports an incomplete restore when a remote file's id does not belong to its path", async () => {
  const key = await generateDEK();
  const data = await encryptFile(
    key,
    { path: "plugins/x/run.js", mtime: 2000 },
    new TextEncoder().encode("x"),
    "alice",
    "id",
  );
  vi.mocked(api.listFiles).mockResolvedValue([{ id: "id", etag: "remote", updated: "2026-01-01", size: data.length }]);
  vi.mocked(api.getFile).mockResolvedValue({ etag: "remote", data });
  sync = await FileSync.create({ userId: "alice", dek: key });
  await expect(sync.fullSync()).rejects.toThrow("1 backup file could not be restored");
  let activity!: FileSyncActivity;
  sync.subscribeActivity((value) => {
    activity = value;
  });
  expect(activity.lastError).toContain("could not be restored");
  expect(await readText("plugins/x/run.js")).toBeUndefined();
});

it("keeps a newer remote edit when a stale local deletion conflicts", async () => {
  const key = await generateDEK();
  const path = "agents/one/AGENTS.md";
  const id = await idFor(path);
  sync = await FileSync.create({ userId: "alice", dek: key });
  sync.start();
  await sync.fullSync();
  await writeText(path, "local");
  await sync.flushDirty();
  vi.mocked(api.deleteFile).mockRejectedValue(new api.ServerError(412, "file conflict"));
  await deleteFile(path);
  await sync.flushDirty();
  expect(api.deleteFile).toHaveBeenCalledWith(id, { ifMatch: "etag" });
  vi.mocked(api.listFiles).mockResolvedValue([{ id, etag: "remote", updated: "2026-01-02", size: 1 }]);
  vi.mocked(api.getFile).mockResolvedValue({
    etag: "remote",
    data: await encryptFile(key, { path, mtime: 3000 }, new TextEncoder().encode("remote edit"), "alice", id),
  });
  await sync.fullSync();
  expect(await readText(path)).toBe("remote edit");
});
