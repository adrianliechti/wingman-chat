import { beginChatBackupPause, finishChatBackupPause } from "./chatBackupActivity";
import { beforeEach, expect, it, vi } from "vitest";
import { FileSync, type FileSyncActivity } from "./fileSync";
import { generateBackupKeys } from "./backupCrypto";
import { decryptFile, generateDEK } from "./crypto";
import { writeJson } from "./opfs-core";
import * as opfs from "./opfs-core";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import * as api from "./storeClient";

vi.mock("./storeClient", () => ({
  listFiles: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
  deleteFile: vi.fn(),
  ServerError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
const memory = new MemoryOpfs();
beforeEach(() => {
  vi.resetAllMocks();
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  vi.mocked(api.putFile).mockResolvedValue("etag");
});

it("reports oversized files as pending without blocking other uploads", async () => {
  const pair = await generateBackupKeys();
  const path = "agents/large/file.bin";
  memory.put(path, "small test data");
  memory.put("agents/other/file.bin", "other");
  const original = opfs.readFileMetadata;
  const metadata = vi.spyOn(opfs, "readFileMetadata").mockImplementation(async (requested) => {
    const result = await original(requested);
    return requested === path && result ? { ...result, size: 256 * 1024 * 1024 + 1 } : result;
  });
  try {
    const sync = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
    await sync.fullSync();
    let activity!: FileSyncActivity;
    sync.subscribeActivity((value) => {
      activity = value;
    });
    expect(activity.pendingCount).toBe(1);
    expect(activity.lastError).toContain("256 MiB backup limit");
    expect(api.putFile).toHaveBeenCalledOnce();
  } finally {
    metadata.mockRestore();
  }
});

it("automatically uploads a local workspace without downloading or decrypting remote files", async () => {
  const pair = await generateBackupKeys();
  memory.put("agents/test/AGENTS.md", "local agent");
  const sync = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  await sync.fullSync();
  expect(api.putFile).toHaveBeenCalledOnce();
  expect(api.listFiles).not.toHaveBeenCalled();
  expect(api.getFile).not.toHaveBeenCalled();
  const [id, cipher] = vi.mocked(api.putFile).mock.calls[0];
  const root = { ...(await generateDEK()), backup: { publicKey: pair.publicKey, privateKey: pair.privateKey } };
  const restored = await decryptFile<{ path: string }>(root, cipher, "alice", id);
  expect(restored.header.path).toBe("agents/test/AGENTS.md");
  expect(new TextDecoder().decode(restored.bytes)).toBe("local agent");
});

it("reports the initial file backup total and advances only confirmed uploads", async () => {
  const pair = await generateBackupKeys();
  memory.put("agents/first/AGENTS.md", "first");
  memory.put("agents/second/AGENTS.md", "second");
  vi.mocked(api.putFile).mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("upload interrupted"));
  const sync = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  const activity: FileSyncActivity[] = [];
  sync.subscribeActivity((value) => activity.push(value));
  await sync.fullSync();
  expect(activity.some((a) => a.progress.some((p) => p.direction === "backup" && p.total === null))).toBe(true);
  expect(
    activity.some((a) => a.progress.some((p) => p.direction === "backup" && p.total === 2 && p.completed === 1)),
  ).toBe(true);
  expect(activity.some((a) => a.progress.some((p) => p.completed === 2))).toBe(false);
  expect(activity.at(-1)).toMatchObject({
    syncing: false,
    progress: [],
    pendingCount: 1,
    lastError: "upload interrupted",
  });
});

it("retains upload conflicts without fetching or overwriting the remote version", async () => {
  const pair = await generateBackupKeys();
  memory.put("agents/test/AGENTS.md", "my edit");
  vi.mocked(api.putFile).mockRejectedValue(new api.ServerError(412, "conflict"));
  const sync = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  await sync.fullSync();
  expect(api.putFile).toHaveBeenCalledOnce();
  expect(api.getFile).not.toHaveBeenCalled();
  let error: string | null = null;
  sync.subscribeActivity((activity) => {
    error = activity.lastError;
  });
  expect(error).toContain("Unlock restore");
  expect(await memory.files.get("agents/test/AGENTS.md")!.text()).toBe("my edit");
  // An empty fresh browser must not interpret remote files as local deletions.
  memory.reset();
  await writeJson("_sync/files.json", { userId: "alice", entries: {} });
  const fresh = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  await fresh.fullSync();
  expect(api.deleteFile).not.toHaveBeenCalled();
});

it("defers server deletions until restore is unlocked", async () => {
  const pair = await generateBackupKeys();
  await writeJson("_sync/files.json", {
    userId: "alice",
    entries: { "agents/deleted.md": { id: "id", etag: "old", mtime: 1000 } },
  });
  const sync = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  await sync.fullSync();
  expect(api.deleteFile).not.toHaveBeenCalled();
  memory.put("agents/new/AGENTS.md", "new work must keep uploading");
  await sync.fullSync();
  expect(api.putFile).toHaveBeenCalledOnce();
  expect(api.deleteFile).not.toHaveBeenCalled();
});

it("keeps the file owner marker until account switching clears the previous workspace", async () => {
  const { ChatSync } = await import("./chatSync");
  const pair = await generateBackupKeys();
  memory.put("agents/private/AGENTS.md", "previous account data");
  await writeJson("_sync/state.json", { userId: "alice", heads: {}, lastFrameHash: {} });
  await writeJson("_sync/files.json", { userId: "alice", entries: {} });
  await writeJson("_sync/upload-key.json", { userId: "bob", publicKey: "pinned" });
  const key = { kid: 1, backup: { publicKey: pair.publicKey } };
  await ChatSync.create({ userId: "bob", dek: key });
  const files = await FileSync.create({ userId: "bob", dek: key });
  await files.fullSync();
  expect(memory.files.has("agents/private/AGENTS.md")).toBe(false);
  expect(memory.files.has("_sync/upload-key.json")).toBe(true);
  expect(api.putFile).not.toHaveBeenCalled();
});

it("keeps generated workspace files local until the LLM request finishes", async () => {
  const pair = await generateBackupKeys();
  const sync = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  const release = beginChatBackupPause("chat");
  try {
    memory.put("agents/generated/AGENTS.md", "partial generated content");
    await sync.fullSync();
    expect(api.putFile).not.toHaveBeenCalled();
    memory.put("agents/generated/AGENTS.md", "final generated content");
  } finally {
    await finishChatBackupPause(release);
  }
  await sync.flushDirty();
  expect(api.putFile).toHaveBeenCalledOnce();
});

it("defers an upload if streaming starts while file encryption is pending", async () => {
  const cryptoModule = await import("./crypto");
  const encrypt = cryptoModule.encryptFile;
  let release: (() => void) | undefined;
  const spy = vi.spyOn(cryptoModule, "encryptFile").mockImplementationOnce(async (...args) => {
    release = beginChatBackupPause("chat");
    return encrypt(...args);
  });
  const pair = await generateBackupKeys();
  const sync = await FileSync.create({ userId: "alice", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  memory.put("agents/paused/AGENTS.md", "pending write");
  try {
    await sync.fullSync();
    expect(spy).toHaveBeenCalled();
    expect(api.putFile).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    if (release) await finishChatBackupPause(release);
  }
  await sync.flushDirty();
  expect(api.putFile).toHaveBeenCalledOnce();
});
