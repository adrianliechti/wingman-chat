import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileSync } from "./fileSync";
import { decryptFile, encryptFile, generateDEK } from "./crypto";
import { deleteDirectory, deleteFile, readText, writeText } from "./opfs-core";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import * as api from "./storeClient";

vi.mock("./storeClient", () => ({
  listFiles: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
  deleteFile: vi.fn(),
}));

const memory = new MemoryOpfs();
let sync: FileSync | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  vi.mocked(api.listFiles).mockResolvedValue([]);
  vi.mocked(api.putFile).mockResolvedValue("etag");
});
afterEach(() => sync?.stop());

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
    paths.map(async (path, index) => {
      const id = String(index);
      const data = await encryptFile(key, { path, mtime: 2000 }, new TextEncoder().encode(path), "alice", id);
      return { id, data, etag: "remote", size: data.length, updated: "2026-11-02T00:00:00Z" };
    }),
  );
  vi.mocked(api.listFiles).mockResolvedValue(remote);
  vi.mocked(api.getFile).mockImplementation(async (id) => remote.find((file) => file.id === id) ?? null);
  sync = await FileSync.create({ userId: "alice", dek: key });
  await sync.fullSync();
  for (const path of paths.slice(0, 2)) expect(await readText(path)).toBe(path);
  for (const path of paths.slice(2)) expect(await readText(path)).toBeUndefined();
  expect(api.putFile).not.toHaveBeenCalled();
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
  expect(api.deleteFile).toHaveBeenCalledWith(id);

  for (const [folder, path] of [
    ["chats/one/artifacts/nested", "chats/one/artifacts/nested/data.txt"],
    ["chats/one", "chats/one/artifacts/data.txt"],
  ]) {
    await writeText(path, "data");
    await sync.flushDirty();
    const latestId = vi.mocked(api.putFile).mock.calls.at(-1)![0];
    await deleteDirectory(folder);
    await sync.flushDirty();
    expect(api.deleteFile).toHaveBeenCalledWith(latestId);
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
