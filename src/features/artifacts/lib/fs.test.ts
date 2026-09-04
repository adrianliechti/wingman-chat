import { beforeEach, describe, expect, it, vi } from "vitest";

const opfs = vi.hoisted(() => ({
  archiveArtifactRevision: vi.fn(),
  deleteArtifact: vi.fn(),
  deleteArtifactFolder: vi.fn(),
  listArtifactEntries: vi.fn(),
  listArtifacts: vi.fn(),
  readArtifact: vi.fn(),
  writeArtifact: vi.fn(),
}));

vi.mock("@/shared/lib/opfs", () => opfs);

import { FileSystemManager, resolveArtifactFileSystem } from "./fs";
import { ArtifactReadWriteManager } from "./artifactFileTools";
import { AgentInvocationContext } from "@/shared/lib/agent-run-controller";

describe("FileSystemManager.renameFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a folder move when any destination file already exists", async () => {
    const files = new Map([
      ["/source/a.html", { content: "a" }],
      ["/source/nested/b.css", { content: "b" }],
      ["/target/nested/b.css", { content: "existing" }],
    ]);
    opfs.listArtifacts.mockResolvedValue([...files.keys()]);
    opfs.readArtifact.mockImplementation(async (_chatId: string, path: string) => files.get(path));

    const moved = await new FileSystemManager("chat").renameFile("/source", "/target");

    expect(moved).toBe(false);
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
    expect(opfs.deleteArtifact).not.toHaveBeenCalled();
    expect(opfs.deleteArtifactFolder).not.toHaveBeenCalled();
  });

  it("rolls back staged destination files when a folder write fails", async () => {
    const files = new Map([
      ["/source/a.html", { content: "a" }],
      ["/source/b.css", { content: "b" }],
    ]);
    opfs.listArtifacts.mockResolvedValue([...files.keys()]);
    opfs.readArtifact.mockImplementation(async (_chatId: string, path: string) => files.get(path));
    let writes = 0;
    opfs.writeArtifact.mockImplementation(async (_chatId: string, path: string, content: string) => {
      files.set(path, { content });
      if (++writes === 2) throw new Error("quota write failure");
    });
    opfs.deleteArtifact.mockResolvedValue(undefined);

    await expect(new FileSystemManager("chat").renameFile("/source", "/target")).rejects.toThrow("quota write failure");

    expect(opfs.deleteArtifactFolder).not.toHaveBeenCalled();
    expect(opfs.deleteArtifact).toHaveBeenCalledTimes(2);
    expect(opfs.deleteArtifact).toHaveBeenCalledWith("chat", "/target/a.html");
    expect(opfs.deleteArtifact).toHaveBeenCalledWith("chat", "/target/b.css");
  });

  it("removes a partial destination when a file write fails", async () => {
    opfs.listArtifacts.mockResolvedValue(["/source.html"]);
    opfs.readArtifact.mockResolvedValue({ content: "source" });
    opfs.writeArtifact.mockRejectedValue(new Error("stream close failure"));
    opfs.deleteArtifact.mockResolvedValue(undefined);

    await expect(new FileSystemManager("chat").renameFile("/source.html", "/target.html")).rejects.toThrow(
      "stream close failure",
    );

    expect(opfs.deleteArtifact).toHaveBeenCalledTimes(1);
    expect(opfs.deleteArtifact).toHaveBeenCalledWith("chat", "/target.html");
  });

  it("rejects moving a folder into itself", async () => {
    opfs.listArtifacts.mockResolvedValue(["/source/a.html"]);

    const moved = await new FileSystemManager("chat").renameFile("/source", "/source/nested");

    expect(moved).toBe(false);
    expect(opfs.readArtifact).not.toHaveBeenCalled();
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
  });
});

describe("FileSystemManager.applyOverlayDelta", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("restores touched files when a later write fails", async () => {
    const files = new Map<string, { content: string; contentType?: string }>([
      ["/existing.txt", { content: "before", contentType: "text/plain" }],
    ]);
    opfs.listArtifactEntries.mockImplementation(async () =>
      [...files].map(([path, file]) => ({
        path,
        contentType: file.contentType,
        size: file.content.length,
      })),
    );
    opfs.readArtifact.mockImplementation(async (_chatId: string, path: string) => files.get(path));
    opfs.archiveArtifactRevision.mockResolvedValue(undefined);
    opfs.deleteArtifact.mockImplementation(async (_chatId: string, path: string) => {
      files.delete(path);
    });
    let writeAttempt = 0;
    opfs.writeArtifact.mockImplementation(
      async (_chatId: string, path: string, content: string, contentType?: string) => {
        files.set(path, { content, contentType });
        writeAttempt++;
        if (writeAttempt === 2) throw new Error("quota write failure");
      },
    );

    await expect(
      new FileSystemManager("chat").applyOverlayDelta({
        upserts: {
          "/existing.txt": { content: "changed", contentType: "text/plain" },
          "/created.txt": { content: "partial", contentType: "text/plain" },
        },
        deletes: [],
      }),
    ).rejects.toThrow("quota write failure");

    expect([...files]).toEqual([["/existing.txt", { content: "before", contentType: "text/plain" }]]);
  });

  it("validates every path before mutating storage", async () => {
    await expect(
      new FileSystemManager("chat").applyOverlayDelta({
        upserts: {
          "/valid.txt": { content: "valid" },
          "../escape.txt": { content: "invalid" },
        },
        deletes: [],
      }),
    ).rejects.toThrow("Artifact path is required");

    expect(opfs.readArtifact).not.toHaveBeenCalled();
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
  });
});

describe("coordinated artifact tools", () => {
  let files: Map<string, { content: string; contentType?: string }>;
  beforeEach(() => {
    vi.resetAllMocks();
    files = new Map([
      ["/a.txt", { content: "alpha" }],
      ["/b.txt", { content: "beta" }],
    ]);
    opfs.readArtifact.mockImplementation(async (_chatId: string, path: string) => files.get(path));
    opfs.listArtifacts.mockImplementation(async () => [...files.keys()]);
    opfs.listArtifactEntries.mockImplementation(async () => [...files.keys()].map((path) => ({ path })));
    opfs.writeArtifact.mockImplementation(
      async (_chatId: string, path: string, content: string, contentType?: string) => {
        files.set(path, { content, contentType });
      },
    );
    opfs.deleteArtifact.mockImplementation(async (_chatId: string, path: string) => {
      files.delete(path);
    });
  });

  it("rejects a stale batch without changing any target, then accepts a reread and own subsequent edits", async () => {
    const fs = new FileSystemManager("freshness");
    const tools = new ArtifactReadWriteManager().createTools(() => fs, { namespace: "artifacts" });
    const invoke = (name: string, args: Record<string, unknown>) =>
      tools.find((tool) => tool.name === name)!.function(args, { runId: "one" });
    await invoke("artifacts_read", { file_path: "/a.txt" });
    await fs.createFile("/a.txt", "alpha externally changed");
    const edit = {
      edits: [
        { file_path: "/b.txt", old_string: "beta", new_string: "B" },
        { file_path: "/a.txt", old_string: "alpha", new_string: "A" },
      ],
    };
    expect(JSON.stringify(await invoke("artifacts_edit", edit))).toContain("changed since");
    expect(files.get("/b.txt")?.content).toBe("beta");
    await invoke("artifacts_read", { file_path: "/a.txt" });
    await invoke("artifacts_edit", edit);
    expect(files.get("/a.txt")?.content).toBe("A externally changed");
    await invoke("artifacts_edit", { edits: [{ file_path: "/a.txt", old_string: "A", new_string: "again" }] });
    expect(files.get("/a.txt")?.content).toBe("again externally changed");
  });

  it("keeps delayed tool calls in the originating chat after navigation, including draft-chat calls", async () => {
    const origin = new Map([["/a.txt", { content: "original" }]]);
    const other = new Map([["/a.txt", { content: "other chat" }]]);
    const chats = new Map([
      ["origin", origin],
      ["other", other],
    ]);
    opfs.readArtifact.mockImplementation(async (chatId, path) => chats.get(chatId)?.get(path));
    opfs.writeArtifact.mockImplementation(async (chatId, path, content) => {
      chats.get(chatId)!.set(path, { content });
    });
    let selected: FileSystemManager | null = null;
    const tools = new ArtifactReadWriteManager().createTools(
      (context) => resolveArtifactFileSystem(selected, context?.chatId),
      { namespace: "artifacts" },
    );
    const create = tools.find((tool) => tool.name === "artifacts_create")!;
    await create.function({ file_path: "/draft.txt", content: "draft" }, { chatId: "origin" });
    expect(origin.get("/draft.txt")?.content).toBe("draft");
    selected = new FileSystemManager("other");
    await create.function({ file_path: "/a.txt", content: "updated" }, { chatId: "origin" });
    expect(origin.get("/a.txt")?.content).toBe("updated");
    expect(other.get("/a.txt")?.content).toBe("other chat");
    expect(resolveArtifactFileSystem(selected, "other")).toBe(selected);
  });

  it("does not report an update when omitted contentType preserves the existing type", async () => {
    files.set("/a.txt", { content: "alpha", contentType: "text/plain" });
    const result = await new FileSystemManager("noop").applyOverlayDelta({
      upserts: { "/a.txt": { content: "alpha" } },
      deletes: [],
    });
    expect(result.updated).toBe(0);
    expect(result.updatedPaths).toEqual([]);
    expect(result.mutations).toEqual([]);
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
  });

  it("retains observations across user turns without letting a child refresh the parent's baseline", async () => {
    const fs = new FileSystemManager("agents");
    const tools = new ArtifactReadWriteManager().createTools(() => fs, { namespace: "artifacts" });
    const read = tools.find((tool) => tool.name === "artifacts_read")!;
    await read.function({ file_path: "/a.txt" }, { runId: "turn-1" });
    await fs.createFile("/a.txt", "alpha external");
    await read.function(
      { file_path: "/a.txt" },
      {
        runId: "child",
        invocationContext: new AgentInvocationContext().fork("subagent"),
      },
    );
    const result = await tools
      .find((tool) => tool.name === "artifacts_edit")!
      .function({ edits: [{ file_path: "/a.txt", old_string: "alpha", new_string: "changed" }] }, { runId: "turn-2" });
    expect(JSON.stringify(result)).toContain("changed since");
    expect(files.get("/a.txt")?.content).toBe("alpha external");
  });

  it("does not lose the main baseline after many short-lived child runs", async () => {
    const fs = new FileSystemManager("many-children");
    const tools = new ArtifactReadWriteManager().createTools(() => fs, { namespace: "artifacts" });
    const read = tools.find((tool) => tool.name === "artifacts_read")!;
    await read.function({ file_path: "/a.txt" }, { runId: "parent" });
    await fs.createFile("/a.txt", "external");
    for (let i = 0; i < 65; i++) {
      await read.function(
        { file_path: "/a.txt" },
        {
          runId: `child-${i}`,
          invocationContext: new AgentInvocationContext().fork("subagent"),
        },
      );
    }
    const result = await tools
      .find((tool) => tool.name === "artifacts_create")!
      .function({ file_path: "/a.txt", content: "overwrite" }, { runId: "next-parent-turn" });
    expect(JSON.stringify(result)).toContain("changed since");
    expect(files.get("/a.txt")?.content).toBe("external");
  });

  it("shares its successful write baseline across exclusive chat and voice turns", async () => {
    const fs = new FileSystemManager("turns");
    const tools = new ArtifactReadWriteManager().createTools(() => fs, { namespace: "artifacts" });
    const create = tools.find((tool) => tool.name === "artifacts_create")!;
    await create.function(
      { file_path: "/new.txt", content: "first" },
      {
        runId: "chat-turn",
        invocationContext: new AgentInvocationContext(),
      },
    );
    const edit = tools.find((tool) => tool.name === "artifacts_edit")!;
    await edit.function(
      { edits: [{ file_path: "/new.txt", old_string: "first", new_string: "second" }] },
      { runId: "voice-turn" },
    );
    expect(files.get("/new.txt")?.content).toBe("second");
    await fs.createFile("/new.txt", "second external");
    const result = await edit.function(
      { edits: [{ file_path: "/new.txt", old_string: "second", new_string: "third" }] },
      { runId: "next-chat-turn", invocationContext: new AgentInvocationContext() },
    );
    expect(JSON.stringify(result)).toContain("changed since");
    expect(files.get("/new.txt")?.content).toBe("second external");
  });

  it("holds the snapshot lock across a commit and queues writes through another manager", async () => {
    const first = new FileSystemManager("concurrent");
    const second = new FileSystemManager("concurrent");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const run = first.withExclusiveAccess(async (access) => {
      const snapshot = await access.getOverlaySnapshot();
      started();
      await gate;
      await access.applyOverlaySnapshot(snapshot, { deleteMissing: true });
    });
    await ready;
    const upload = second.createFile("/upload.txt", "user upload");
    await Promise.resolve();
    expect(files.has("/upload.txt")).toBe(false);
    release();
    await Promise.all([run, upload]);
    expect(files.get("/upload.txt")?.content).toBe("user upload");
  });

  it("restores source files even if a move fails after deleting one", async () => {
    let deletes = 0;
    opfs.deleteArtifact.mockImplementation(async (_chatId: string, path: string) => {
      files.delete(path);
      if (++deletes === 1) throw new Error("delete failed after removing source");
    });
    await expect(new FileSystemManager("move").renameFile("/a.txt", "/moved.txt")).rejects.toThrow("delete failed");
    expect(files.get("/a.txt")?.content).toBe("alpha");
    expect(files.has("/moved.txt")).toBe(false);
    expect(files.get("/b.txt")?.content).toBe("beta");
    expect(opfs.writeArtifact.mock.calls.some((call) => call[1] === "/b.txt")).toBe(false);
  });

  it("rejects ingestion below an existing file before committing any files", async () => {
    await expect(
      new FileSystemManager("ingest-tree").ingestFiles([
        { path: "/valid.txt", content: "valid" },
        { path: "/a.txt/nested.txt", content: "blocked" },
      ]),
    ).rejects.toThrow("parent path is an existing file");
    expect(files.has("/valid.txt")).toBe(false);
    expect(files.get("/a.txt")?.content).toBe("alpha");
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
  });

  it("rejects moving onto an ancestor directory without overwriting nested sources", async () => {
    files.set("/parent/nested/x.txt", { content: "one" });
    files.set("/parent/nested/nested/x.txt", { content: "two" });
    expect(await new FileSystemManager("move-tree").renameFile("/parent/nested", "/parent")).toBe(false);
    expect(files.get("/parent/nested/x.txt")?.content).toBe("one");
    expect(files.get("/parent/nested/nested/x.txt")?.content).toBe("two");
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
    expect(opfs.deleteArtifact).not.toHaveBeenCalled();
  });
});
