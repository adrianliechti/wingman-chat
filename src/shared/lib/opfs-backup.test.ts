import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as opfs from "./opfs";
import { readZipFiles, restoreFiles } from "./opfs-restore";
import { PersistenceQueue, registerPersistenceQueue } from "./persistence";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import { downloadBlob } from "./utils";

vi.mock("./utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./utils")>()),
  downloadBlob: vi.fn(async () => {}),
}));

const memory = new MemoryOpfs();
const storedChat = (id: string, extra = {}) =>
  JSON.stringify({
    id,
    created: "2020-01-01",
    updated: "2020-01-02",
    messages: [],
    model: null,
    ...extra,
  });
const zipBlob = async (files: Record<string, string>) => {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(files)) zip.file(path, text);
  return new Blob([await zip.generateAsync({ type: "arraybuffer" })]);
};
beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});

describe("backup and restore", () => {
  it("flushes pending edits before exporting and round-trips a full backup", async () => {
    memory.put("chats/one/chat.json", storedChat("one", { customTitle: "Title", customIndex: 8 }));
    memory.put("chats/one/artifacts/nested/a.txt", "artifact");
    memory.put("profile.json", '{"name":"Before"}');
    memory.put("skills/example/SKILL.md", "---\nname: example\ndescription: Example\n---\nBody");
    memory.put(
      "skills/index.json",
      JSON.stringify([{ id: "original-skill-id", title: "example", updated: "2020-01-02" }]),
    );
    const queue = new PersistenceQueue(vi.fn());
    const unregister = registerPersistenceQueue(queue);
    queue.schedule("profile", () => opfs.writeJson("profile.json", { name: "Latest" }));
    let backup: Blob;
    try {
      backup = await opfs.exportFolderAsZip("/");
    } finally {
      unregister();
    }
    memory.reset();
    await opfs.importFolderFromZip("/", backup);
    expect(await opfs.readJson("profile.json")).toEqual({ name: "Latest" });
    expect(await opfs.readText("chats/one/artifacts/nested/a.txt")).toBe("artifact");
    expect(await opfs.readIndex("chats")).toMatchObject([
      { id: "one", customTitle: "Title", customIndex: 8, updated: "2020-01-02" },
    ]);
    expect(await opfs.readIndex("skills")).toEqual([
      { id: "original-skill-id", title: "example", updated: "2020-01-02" },
    ]);
  });

  it("keeps existing records and ignores the source collection index when merging", async () => {
    memory.put("chats/existing/chat.json", storedChat("existing"));
    memory.put("chats/index.json", JSON.stringify([{ id: "existing", updated: "2020-01-02" }]));
    const backup = await zipBlob({
      "one/chat.json": storedChat("one"),
      "index.json": JSON.stringify([{ id: "fake" }]),
    });
    await opfs.importFolderFromZip("chats", backup);
    expect((await opfs.readIndex("chats")).map((entry) => entry.id).sort()).toEqual(["existing", "one"]);
  });

  it("accepts wrapped backups and repairs a missing file without deleting unrelated files", async () => {
    memory.put("chats/one/chat.json", storedChat("one"));
    memory.put("chats/one/artifacts/keep.txt", "keep");
    const files = await readZipFiles(await zipBlob({ "backup/chats/one/blobs/missing.bin": "bytes" }));
    await restoreFiles(files);
    expect(await opfs.readText("chats/one/blobs/missing.bin")).toBe("bytes");
    expect(await opfs.readText("chats/one/artifacts/keep.txt")).toBe("keep");
  });

  it("skips an agent file with empty metadata instead of failing the restore", async () => {
    memory.put("profile.json", '{"name":"Before"}');
    await restoreFiles(
      new Map([
        ["profile.json", new Blob(['{"name":"After"}'])],
        ["agents/one/files/gone/metadata.json", new Blob([""])],
        ["agents/one/files/gone/content.txt", new Blob(["orphan"])],
        ["agents/one/files/gone/segments.json", new Blob(["not json"])],
      ]),
    );
    expect(await opfs.readJson("profile.json")).toEqual({ name: "After" });
    expect(await opfs.readText("agents/one/files/gone/content.txt")).toBeUndefined();
    expect(await opfs.readText("agents/one/files/gone/segments.json")).toBeUndefined();
  });

  it("validates metadata before overwriting any saved file", async () => {
    memory.put("profile.json", '{"name":"Before"}');
    await expect(
      restoreFiles(
        new Map([
          ["profile.json", new Blob(['{"name":"After"}'])],
          ["chats/broken/chat.json", new Blob(["{broken"])],
        ]),
      ),
    ).rejects.toThrow("Invalid JSON");
    expect(await opfs.readJson("profile.json")).toEqual({ name: "Before" });
    expect(memory.closed).toEqual([]);
  });

  it.each([
    ["skills/valid/SKILL.md", "not a skill"],
    ["chats/one/chat.json", JSON.stringify({ ...JSON.parse(storedChat("one")), messages: [null] })],
    ["agents/one/files/file/segments.json", "[42]"],
  ])("rejects malformed %s before touching the profile", async (path, content) => {
    memory.put("profile.json", '{"name":"Before"}');
    await expect(
      restoreFiles(
        new Map([
          ["profile.json", new Blob(['{"name":"After"}'])],
          [path, new Blob([content])],
        ]),
      ),
    ).rejects.toThrow(/Invalid/);
    expect(await opfs.readJson("profile.json")).toEqual({ name: "Before" });
    expect(memory.closed).toEqual([]);
  });

  it("rolls back imported files and index changes when rebuilding a later index fails", async () => {
    memory.put("chats/old/chat.json", storedChat("old"));
    memory.put("chats/index.json", JSON.stringify([{ id: "old", updated: "2020-01-02" }]));
    let failed = false;
    memory.beforeWrite = async (path) => {
      if (path === "skills/index.json" && !failed) {
        failed = true;
        throw new Error("index failed");
      }
    };
    await expect(
      restoreFiles(
        new Map([
          ["chats/new/chat.json", new Blob([storedChat("new")])],
          ["skills/valid/SKILL.md", new Blob(["---\nname: valid\ndescription: Description\n---\nBody"])],
        ]),
      ),
    ).rejects.toThrow("index failed");
    expect(await opfs.readIndex("chats")).toEqual([{ id: "old", updated: "2020-01-02" }]);
    expect(await opfs.readText("chats/new/chat.json")).toBeUndefined();
    expect(await opfs.readText("skills/valid/SKILL.md")).toBeUndefined();
  });

  it("rolls back replaced files, partial new records, and indexes after a write failure", async () => {
    memory.put("profile.json", '{"name":"Before"}');
    memory.put("chats/old/chat.json", storedChat("old"));
    memory.put("chats/index.json", JSON.stringify([{ id: "old", updated: "2020-01-02" }]));
    const before = new Map(
      await Promise.all([...memory.files].map(async ([path, blob]) => [path, await blob.text()] as const)),
    );
    let failed = false;
    memory.beforeWrite = async (path) => {
      if (path === "chats/new/chat.json" && !failed) {
        failed = true;
        throw new Error("quota");
      }
    };
    await expect(
      restoreFiles(
        new Map([
          ["profile.json", new Blob(['{"name":"After"}'])],
          ["chats/new/chat.json", new Blob([storedChat("new")])],
        ]),
      ),
    ).rejects.toThrow("quota");
    const after = new Map(
      await Promise.all([...memory.files].map(async ([path, blob]) => [path, await blob.text()] as const)),
    );
    expect(after).toEqual(before);
    expect(await opfs.listDirectories("chats")).toEqual(["old"]);
  });

  it("rejects path traversal even when the ZIP library sanitizes its filename", async () => {
    await expect(readZipFiles(await zipBlob({ "../profile.json": "{}" }))).rejects.toThrow("Invalid archive path");
    expect(memory.closed).toEqual([]);
  });

  it("fails an export on a read error rather than producing an incomplete archive", async () => {
    memory.put("chats/one/chat.json", storedChat("one"));
    memory.beforeRead = async () => {
      throw new Error("read denied");
    };
    await expect(opfs.exportFolderAsZip("chats")).rejects.toThrow("read denied");
  });

  it("rebuilds only recognizable records and preserves skill IDs and old timestamps", async () => {
    memory.put("skills/index.json", JSON.stringify([{ id: "stable-id", title: "valid", updated: "2020-01-02" }]));
    memory.put("skills/valid/SKILL.md", "---\nname: valid\ndescription: A skill\n---\nBody");
    memory.put("skills/unrelated/readme.txt", "keep");
    memory.put("agents/unrelated/file.txt", "keep");
    await opfs.rebuildFolderIndex("skills");
    await opfs.rebuildFolderIndex("agents");
    expect(await opfs.readIndex("skills")).toEqual([{ id: "stable-id", title: "valid", updated: "2020-01-02" }]);
    expect(await opfs.readIndex("agents")).toEqual([]);
    expect(await opfs.readText("skills/unrelated/readme.txt")).toBe("keep");
  });

  it("keeps legacy chat histories out of the rebuilt index while preserving sidebar metadata", async () => {
    memory.put(
      "chats/legacy.json",
      storedChat("embedded-id", {
        title: "Original title",
        customTitle: "My title",
        customIndex: 3,
        model: { id: "model" },
        messages: [{ id: "message", role: "user", content: [{ type: "text", text: "History" }] }],
      }),
    );

    await opfs.rebuildFolderIndex("chats");

    expect(await opfs.readIndex("chats")).toEqual([
      {
        id: "legacy",
        title: "Original title",
        customTitle: "My title",
        customIndex: 3,
        created: "2020-01-01",
        updated: "2020-01-02",
      },
    ]);
    expect(await opfs.readJson("chats/legacy.json")).toMatchObject({
      messages: [{ id: "message", content: [{ text: "History" }] }],
    });
  });
});

describe("backups with damaged saved data", () => {
  const corrupt = '{"id":"broken","messages":[';

  it("exports a selected root file next to folders as a plain file entry", async () => {
    memory.put("profile.json", '{"name":"Me"}');
    memory.put("chats/one/chat.json", storedChat("one"));
    await opfs.downloadFoldersAsZip(["chats", "profile.json", "images"], "backup.zip");
    const blob = vi.mocked(downloadBlob).mock.calls.at(-1)?.[0];
    expect(blob).toBeInstanceOf(Blob);
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    expect(zip.files["profile.json"]?.dir).toBe(false);
    expect(await zip.files["profile.json"].async("text")).toBe('{"name":"Me"}');
    expect(zip.files["profile.json/"]).toBeUndefined();
    expect(zip.files["chats/one/chat.json"]).toBeDefined();
  });

  it("exports saved data even when a pending save keeps failing", async () => {
    memory.put("chats/one/chat.json", storedChat("one"));
    const queue = new PersistenceQueue(vi.fn());
    const unregister = registerPersistenceQueue(queue);
    queue.schedule("one", async () => {
      throw new Error("Invalid index in chats/index.json");
    });
    try {
      const backup = await opfs.exportFolderAsZip("/");
      const zip = await JSZip.loadAsync(await backup.arrayBuffer());
      expect(zip.files["chats/one/chat.json"]).toBeDefined();
      await opfs.downloadFoldersAsZip(["chats"], "backup.zip");
      expect(vi.mocked(downloadBlob).mock.calls.at(-1)?.[1]).toBe("backup.zip");
    } finally {
      unregister();
    }
  });

  it("rebuilds indexes past records with invalid JSON instead of failing", async () => {
    memory.put("chats/broken/chat.json", corrupt);
    memory.put("chats/legacy-broken.json", corrupt);
    memory.put("chats/one/chat.json", storedChat("one"));
    memory.put("images/broken/metadata.json", corrupt);
    memory.put("images/ok/metadata.json", JSON.stringify({ id: "ok", updated: "2020-01-02" }));
    memory.put("agents/broken/agent.json", corrupt);
    expect(await opfs.rebuildFolderIndex("chats")).toMatchObject([{ id: "one" }]);
    expect(await opfs.rebuildFolderIndex("images")).toMatchObject([{ id: "ok" }]);
    expect(await opfs.rebuildFolderIndex("agents")).toEqual([]);
    expect(await opfs.readText("chats/broken/chat.json")).toBe(corrupt);
  });

  it("still fails an index rebuild on a storage read error", async () => {
    memory.put("chats/one/chat.json", storedChat("one"));
    memory.beforeRead = async (path) => {
      if (path === "chats/one/chat.json") throw new DOMException("read denied", "NotReadableError");
    };
    await expect(opfs.rebuildFolderIndex("chats")).rejects.toThrow("read denied");
  });

  it("restores a backup while an unrelated saved record is corrupt", async () => {
    memory.put("chats/broken/chat.json", corrupt);
    memory.put("chats/index.json", JSON.stringify([{ id: "broken", updated: "2020-01-02" }]));
    await restoreFiles(new Map([["chats/new/chat.json", new Blob([storedChat("new")])]]));
    expect(await opfs.readText("chats/new/chat.json")).toBe(storedChat("new"));
    // The damaged record keeps its previous listing; the file stays for recovery.
    expect(await opfs.readIndex("chats")).toMatchObject([{ id: "broken", updated: "2020-01-02" }, { id: "new" }]);
    expect(await opfs.readText("chats/broken/chat.json")).toBe(corrupt);
  });
});
