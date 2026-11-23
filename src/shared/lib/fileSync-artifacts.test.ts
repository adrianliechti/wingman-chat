import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSync, type FileSyncActivity } from "./fileSync";
import { decryptFile, encryptFile } from "./crypto";
import {
  deleteDirectory,
  deleteFile,
  readFileMetadata as readFileMetadataFor,
  readText,
  writeJson,
  writeText,
} from "./opfs-core";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import * as api from "./storeClient";
import {
  archiveArtifactRevision,
  loadArtifactRevision,
  readArtifact,
  writeArtifact,
  listArtifactRevisionEntries,
} from "./opfs-artifacts";
import { artifactRevision } from "@/shared/types/artifact";
import { generateStoreKey } from "./test-support/storeKey";

vi.mock("./storeClient", async (importOriginal) => ({
  ServerError: (await importOriginal<typeof import("./storeClient")>()).ServerError,
  listFiles: vi.fn(),
  listChats: vi.fn(),
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
  vi.mocked(api.listChats).mockResolvedValue([]);
  vi.mocked(api.putFile).mockResolvedValue("etag");
});
afterEach(() => sync?.stop());

it("restores an attachment's pinned revision even when its live artifact has changed", async () => {
  const key = await generateStoreKey();
  const remote = new Map<string, { data: Uint8Array; etag: string }>();
  vi.mocked(api.putFile).mockImplementation(async (id, data) => {
    remote.set(id, { data, etag: "etag" });
    return "etag";
  });
  vi.mocked(api.listFiles).mockImplementation(async () =>
    [...remote].map(([id, file]) => ({
      id,
      etag: file.etag,
      size: file.data.length,
      updated: "2026-01-01",
    })),
  );
  vi.mocked(api.getFile).mockImplementation(async (id) => remote.get(id) ?? null);
  const revision = await artifactRevision("original attachment", "text/plain");
  await archiveArtifactRevision("chat", {
    path: "/doc.txt",
    revision,
    content: "original attachment",
    contentType: "text/plain",
    createdAt: "2026-01-01T00:00:00Z",
  });
  await writeArtifact("chat", "/doc.txt", "edited artifact", "text/plain");
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  await sync.fullSync();
  memory.reset();
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  await sync.fullSync();
  expect(await readArtifact("chat", "/doc.txt")).toMatchObject({ content: "edited artifact" });
  expect(await loadArtifactRevision("chat", "/doc.txt", revision)).toMatchObject({ content: "original attachment" });
  expect(await listArtifactRevisionEntries("chat", "/doc.txt")).toMatchObject([{ revision }]);
});

it("does not restore an unknown remote file after its directory is deleted during download", async () => {
  const key = await generateStoreKey();
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
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  sync.start();
  await vi.waitFor(() => expect(release).toBeDefined());
  await deleteDirectory("agents/one");
  release({ etag: "remote", data });
  await sync.fullSync();
  expect(await readText(path)).toBeUndefined();
});

it.each(["update", "deletion"])("preserves a local edit made while a remote %s is being listed", async (kind) => {
  const key = await generateStoreKey();
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
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  sync.start();
  await vi.waitFor(() => expect(release).toBeDefined());
  await writeText(path, "local edit");
  release(kind === "update" ? [{ id, etag: "remote", updated: "2026-01-01T00:00:00Z", size: 1 }] : []);
  await sync.fullSync();
  expect(await readText(path)).toBe("local edit");
  expect(api.putFile).toHaveBeenCalled();
});

it("backs up current artifacts, immutable revisions, and workspace data without chat internals", async () => {
  const key = await generateStoreKey();
  const paths = [
    "chats/one/artifacts/nested/report.html",
    "chats/one/artifacts/chart.png",
    "chats/two/artifact-state/%2Freport.html.json",
    "chats/one/artifact-versions/report/revision.json",
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
    "chats/one/artifact-versions/report/history.json",
    "_sync/upload-key.json",
  ];
  for (const path of [...paths, ...excluded]) memory.put(path, `bytes:${path}`);
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
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

it("restores artifacts, immutable revisions, and saved app data while refusing chat manifests", async () => {
  const key = await generateStoreKey();
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
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  const activity: FileSyncActivity[] = [];
  sync.subscribeActivity((value) => activity.push(value));
  await sync.fullSync();
  for (const path of paths.slice(0, 3)) expect(await readText(path)).toBe(path);
  for (const path of paths.slice(3)) expect(await readText(path)).toBeUndefined();
  expect(api.putFile).not.toHaveBeenCalled();
  expect(
    activity.some((a) => a.progress.some((p) => p.direction === "restore" && p.total === 4 && p.completed === 1)),
  ).toBe(true);
  expect(activity.at(-1)).toMatchObject({ syncing: false, progress: [] });
});

it("tracks artifact edits and file/folder/chat deletions through OPFS mutations", async () => {
  const key = await generateStoreKey();
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  sync.start();
  await sync.fullSync();
  const file = "chats/one/artifacts/report.txt";
  await writeText(file, "final artifact");
  await writeText("chats/one/artifact-versions/report/history.json", "derived listing");
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

it("keeps nested directory version markers out of the file upload queue", async () => {
  const key = await generateStoreKey();
  memory.put("agents/one/AGENTS.md", "agent");
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
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
  const key = await generateStoreKey();
  const path = "agents/one/AGENTS.md";
  const id = await idFor(path);
  vi.mocked(api.listFiles).mockResolvedValue([{ id, etag: "remote", updated: "2026-01-01", size: 3 }]);
  vi.mocked(api.getFile).mockResolvedValue({ etag: "remote", data: new Uint8Array([1, 2, 3]) });
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
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
  const key = await generateStoreKey();
  const data = await encryptFile(
    key,
    { path: "plugins/x/run.js", mtime: 2000 },
    new TextEncoder().encode("x"),
    "alice",
    "id",
  );
  vi.mocked(api.listFiles).mockResolvedValue([{ id: "id", etag: "remote", updated: "2026-01-01", size: data.length }]);
  vi.mocked(api.getFile).mockResolvedValue({ etag: "remote", data });
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  await expect(sync.fullSync()).rejects.toThrow("1 backup file could not be restored");
  let activity!: FileSyncActivity;
  sync.subscribeActivity((value) => {
    activity = value;
  });
  expect(activity.lastError).toContain("could not be restored");
  expect(await readText("plugins/x/run.js")).toBeUndefined();
});

it("keeps a newer remote edit when a stale local deletion conflicts", async () => {
  const key = await generateStoreKey();
  const path = "agents/one/AGENTS.md";
  const id = await idFor(path);
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
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

it("preserves skill index entries whose IDs differ from their folder names", async () => {
  const key = await generateStoreKey();
  const index = JSON.stringify([{ id: "skill-uuid", title: "my-skill", updated: "2026-01-01" }]);
  memory.put("skills/index.json", index);
  memory.put("skills/my-skill/SKILL.md", "skill content");
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  await sync.fullSync();
  expect(await readText("skills/index.json")).toBe(index);
});

describe("chat workspace files follow their chat's deletion", () => {
  const path = "chats/one/artifacts/report.txt";
  const journal = "_sync/deletes/u-alice/one.json";
  const marker = "_sync/keep-files/u-alice/one.json";

  async function syncedArtifact(key: Awaited<ReturnType<typeof generateStoreKey>>) {
    const id = await idFor(path);
    const data = await encryptFile(key, { path, mtime: 1000 }, new TextEncoder().encode("report"), "alice", id);
    vi.mocked(api.getFile).mockResolvedValue({ etag: "etag", data });
    vi.mocked(api.listFiles).mockResolvedValue([{ id, etag: "etag", updated: "2026-01-01", size: data.length }]);
    await writeJson("_sync/files.json", { userId: "alice", entries: { [path]: { id, etag: "etag", mtime: 1000 } } });
    return id;
  }

  it("keeps the backup copy while the chat deletion is pending and restores it when cancelled", async () => {
    const key = await generateStoreKey();
    await syncedArtifact(key);
    await writeJson(journal, { id: "one", token: "t", expectedSeq: 3 });
    sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
    await sync.fullSync();
    expect(api.deleteFile).not.toHaveBeenCalled();

    // Another device saved newer work: the server cancelled the deletion.
    await deleteFile(journal);
    await writeJson(marker, { id: "one", token: "t", kind: "restore" });
    vi.mocked(api.listChats).mockResolvedValue([{ id: "one", headSeq: 5, updated: "2026-01-02" }]);
    // The pull may restore the chat itself before the files come back.
    await writeJson("chats/one/chat.json", { id: "one", messages: [] });
    await sync.fullSync();
    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(await readText(path)).toBe("report");
    expect(await readText(marker)).toBeUndefined();

    // Afterwards, deleting the restored file is an ordinary single deletion.
    await deleteFile(path);
    await sync.fullSync();
    expect(api.deleteFile).toHaveBeenCalledOnce();
  });

  it("restores files of a removed chat that still lives in the backup", async () => {
    const key = await generateStoreKey();
    await syncedArtifact(key);
    vi.mocked(api.listChats).mockResolvedValue([{ id: "one", headSeq: 5, updated: "2026-01-02" }]);
    sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
    await sync.fullSync();
    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(await readText(path)).toBe("report");
  });

  it("deletes files once the chat is deleted in the backup", async () => {
    const key = await generateStoreKey();
    const id = await syncedArtifact(key);
    vi.mocked(api.listChats).mockResolvedValue([{ id: "one", headSeq: 5, updated: "2026-01-02", deleted: true }]);
    sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
    await sync.fullSync();
    expect(api.deleteFile).toHaveBeenCalledWith(id, { ifMatch: "etag" });
  });

  it("lets another device delete a single file of a live chat with pending edits", async () => {
    const key = await generateStoreKey();
    const id = await idFor(path);
    memory.put(path, "report");
    const { lastModified } = (await readFileMetadataFor(path))!;
    await writeJson("_sync/files.json", {
      userId: "alice",
      entries: { [path]: { id, etag: "etag", mtime: lastModified } },
    });
    await writeJson("chats/one/target.json", { id: "one", messages: [] });
    vi.mocked(api.listChats).mockResolvedValue([{ id: "one", headSeq: 5, updated: "2026-01-02" }]);
    sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
    await sync.fullSync();
    expect(await readText(path)).toBeUndefined();
    expect(api.putFile).not.toHaveBeenCalled();
  });

  it.each(["marker", "pending edit"])("re-uploads files of a chat recreated by a %s", async (reason) => {
    const key = await generateStoreKey();
    const id = await idFor(path);
    memory.put(path, "report");
    const { lastModified } = (await readFileMetadataFor(path))!;
    await writeJson("_sync/files.json", {
      userId: "alice",
      entries: { [path]: { id, etag: "etag", mtime: lastModified } },
    });
    if (reason === "marker") await writeJson(marker, { id: "one", token: "t", kind: "reupload" });
    else await writeJson("chats/one/target.json", { id: "one", messages: [] });
    vi.mocked(api.putFile).mockRejectedValueOnce(new api.ServerError(412, "gone"));
    vi.mocked(api.getFile).mockResolvedValue(null);
    sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
    await sync.fullSync();
    expect(await readText(path)).toBe("report");
    expect(api.putFile).toHaveBeenLastCalledWith(id, expect.anything(), { ifNoneMatch: "*" });
  });
});

it("still uploads a merged collection index after a reload interrupts its upload", async () => {
  const key = await generateStoreKey();
  const path = "agents/index.json";
  const id = await idFor(path);
  const localEntry = { id: "local", updated: "2026-01-01" };
  const remoteEntry = { id: "remote", updated: "2026-01-01" };
  memory.put(path, JSON.stringify([localEntry]));
  const data = await encryptFile(
    key,
    { path, mtime: 1000 },
    new TextEncoder().encode(JSON.stringify([remoteEntry])),
    "alice",
    id,
  );
  vi.mocked(api.listFiles).mockResolvedValue([{ id, etag: "remote", updated: "2026-01-01", size: data.length }]);
  vi.mocked(api.getFile).mockResolvedValue({ etag: "remote", data });
  vi.mocked(api.putFile).mockRejectedValue(new Error("offline"));
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  await sync.fullSync();
  expect(JSON.parse((await readText(path))!)).toEqual([localEntry, remoteEntry]);

  vi.mocked(api.putFile).mockReset();
  vi.mocked(api.putFile).mockResolvedValue("merged");
  sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
  await sync.fullSync();
  const uploaded = vi.mocked(api.putFile).mock.calls.find(([fileId]) => fileId === id);
  expect(uploaded).toBeDefined();
  const { bytes } = await decryptFile(key, uploaded![1], "alice", id);
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual([localEntry, remoteEntry]);
});

describe("file conflicts keep the losing version", () => {
  const path = "agents/one/notes.md";
  const copyOf = async (bytes: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes));
    const tag = Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
    return `agents/one/notes (conflicted copy ${tag}).md`;
  };

  it.each([
    ["the backup's copy is newer", 9e15, "remote", "local"],
    ["this device's copy is newer", 1, "local", "remote"],
  ])("when %s", async (_case, remoteMtime, winner, loser) => {
    const key = await generateStoreKey();
    const id = await idFor(path);
    memory.put(path, "local");
    await writeJson("_sync/files.json", { userId: "alice", entries: { [path]: { id, etag: "old", mtime: 1 } } });
    vi.mocked(api.putFile).mockRejectedValueOnce(new api.ServerError(412, "changed elsewhere"));
    vi.mocked(api.getFile).mockResolvedValue({
      etag: "remote",
      data: await encryptFile(key, { path, mtime: remoteMtime }, new TextEncoder().encode("remote"), "alice", id),
    });
    sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
    await sync.flushDirty().catch(() => {});
    await sync.fullSync().catch(() => {});
    if (winner === "remote") expect(await readText(path)).toBe("remote");
    expect(await readText(await copyOf(loser))).toBe(loser);
  });

  it("when an untracked local file is older than the backup's copy", async () => {
    const key = await generateStoreKey();
    const id = await idFor(path);
    memory.put(path, "local");
    const data = await encryptFile(key, { path, mtime: 9e15 }, new TextEncoder().encode("remote"), "alice", id);
    vi.mocked(api.listFiles).mockResolvedValue([{ id, etag: "remote", updated: "2026-01-01", size: data.length }]);
    vi.mocked(api.getFile).mockResolvedValue({ etag: "remote", data });
    sync = await FileSync.create({ userId: "alice", accountId: "alice", dek: key });
    await sync.fullSync();
    expect(await readText(path)).toBe("remote");
    expect(await readText(await copyOf("local"))).toBe("local");
  });
});
