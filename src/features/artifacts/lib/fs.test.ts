import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opfs = vi.hoisted(() => ({
  archiveArtifactRevision: vi.fn(),
  copyArtifactRevisionHistory: vi.fn(),
  deleteArtifact: vi.fn(),
  deleteArtifactFolder: vi.fn(),
  listArtifactEntries: vi.fn(),
  listArtifactRevisionEntries: vi.fn(),
  listArtifacts: vi.fn(),
  loadArtifactRevision: vi.fn(),
  readArtifact: vi.fn(),
  writeArtifact: vi.fn(),
}));

vi.mock("@/shared/lib/opfs", () => opfs);

import { FileSystemManager, resolveArtifactFileSystem } from "./fs";
import { ArtifactReadWriteManager } from "./artifactFileTools";
import { AgentInvocationContext } from "@/shared/lib/agent-run-controller";
import { executeArtifactCode, type SandboxExecutor } from "./executeArtifactCode";
import { setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import { artifactRevision } from "@/shared/types/artifact";

describe("FileSystemManager.renameFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reserves the memory mount even for code/runtime artifact writes", async () => {
    const fs = new FileSystemManager("chat");
    await expect(fs.createFile("/.memory/note.md", "Cannot bypass memory validation")).rejects.toThrow("reserved");
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
  });

  it("reserves the virtual library folder", async () => {
    const fs = new FileSystemManager("chat");
    await expect(fs.createFile("/.lib/echarts.js", "var echarts")).rejects.toThrow("virtual folder");
    await expect(fs.createFile("/.lib", "x")).rejects.toThrow("virtual folder");
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
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

  afterEach(() => setSkillResourceResolver("fs-test-skills", null));

  it("notifies subscribers through other managers for the same chat and cleans up subscriptions", async () => {
    const viewer = new FileSystemManager("events");
    const writer = new FileSystemManager("events");
    const changed = vi.fn();
    const unrelated = vi.fn();
    const stop = viewer.subscribe("fileUpdated", changed);
    const stopOther = new FileSystemManager("unrelated").subscribe("fileUpdated", unrelated);
    try {
      await writer.createFile("a.txt", "updated");
      expect(changed).toHaveBeenCalledExactlyOnceWith("/a.txt");
      expect(unrelated).not.toHaveBeenCalled();
      stop();
      await writer.createFile("a.txt", "again");
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      stopOther();
    }
  });

  it("does not publish phantom creates or deletes from a rolled-back batch", async () => {
    const fs = new FileSystemManager("rollback-events");
    const changed = vi.fn();
    const subscriptions = [fs.subscribe("fileCreated", changed), fs.subscribe("fileDeleted", changed)];
    const remove = opfs.deleteArtifact.getMockImplementation()!;
    opfs.deleteArtifact.mockImplementation(async (chatId, path) => {
      if (path === "/b.txt") throw new Error("delete failed");
      await remove(chatId, path);
    });
    try {
      await expect(
        fs.applyOverlayDelta({
          upserts: { "/new.txt": { content: "temporary" } },
          deletes: ["/a.txt", "/b.txt"],
        }),
      ).rejects.toThrow("delete failed");
      expect(files.get("/a.txt")?.content).toBe("alpha");
      expect(files.has("/new.txt")).toBe(false);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  });

  it("keeps a cancelled interpreter snapshot out of storage and releases queued writes", async () => {
    const fs = new FileSystemManager("cancel-code");
    const controller = new AbortController();
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const executor = vi.fn<SandboxExecutor>(async () => {
      await gate;
      return { success: true, output: "late", files: { "/late.txt": { content: "discard" } } };
    });
    const run = executeArtifactCode({
      fs,
      executor,
      args: { code: "run" },
      extension: "js",
      context: { signal: controller.signal },
    });
    await vi.waitFor(() => expect(executor).toHaveBeenCalled());
    const queued = new FileSystemManager(fs.chatId).createFile("/queued.txt", "keep");
    controller.abort();
    expect((await run).success).toBe(false);
    await queued;
    finish();
    await Promise.resolve();
    expect([...files.keys()].sort()).toEqual(["/a.txt", "/b.txt", "/queued.txt"]);
  });

  it("never commits files returned by a failed interpreter", async () => {
    const result = await executeArtifactCode({
      fs: new FileSystemManager("failed-code"),
      executor: async () => ({ success: false, output: "", error: "script failed", files: {} }),
      args: { code: "run" },
      extension: "py",
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("script failed") });
    expect([...files.keys()]).toEqual(["/a.txt", "/b.txt"]);
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
    expect(opfs.deleteArtifact).not.toHaveBeenCalled();
  });

  it("reports missing or invalid scripts as execution failures and preserves the workspace", async () => {
    const fs = new FileSystemManager("invalid-script");
    const executor = vi.fn<SandboxExecutor>();
    for (const args of [{}, { path: "/missing.py" }, { path: "../outside.py" }]) {
      const result = await executeArtifactCode({ fs, executor, args, extension: "py" });
      expect(result.success).toBe(false);
    }
    expect(executor).not.toHaveBeenCalled();
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
    expect(opfs.deleteArtifact).not.toHaveBeenCalled();
  });

  it("serializes complete interpreter runs so each sees the previous run's committed files", async () => {
    const fs = new FileSystemManager("two-engines");
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = vi.fn<SandboxExecutor>(async ({ files }) => {
      await gate;
      return { success: true, output: "first", files: { ...files, "/generated.txt": { content: "generated" } } };
    });
    const second = vi.fn<SandboxExecutor>(async ({ files }) => {
      expect(files?.["/generated.txt"].content).toBe("generated");
      return { success: true, output: "second", files: { ...files, "/generated.txt": { content: "updated" } } };
    });
    const run = executeArtifactCode({ fs, executor: first, args: { code: "first" }, extension: "py" });
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    const next = executeArtifactCode({
      fs: new FileSystemManager(fs.chatId),
      executor: second,
      args: { code: "second" },
      extension: "js",
    });
    expect(second).not.toHaveBeenCalled();
    finish();
    expect((await run).success).toBe(true);
    expect((await next).success).toBe(true);
    expect(files.get("/generated.txt")?.content).toBe("updated");
  });

  it("strips mounted skill resources without discarding a real artifact at the same path", async () => {
    const path = "/skills/test/existing.txt";
    files.set(path, { content: "real artifact" });
    setSkillResourceResolver("fs-test-skills", async () => ({
      [path]: { content: "skill version" },
      "/skills/test/resource.txt": { content: "resource" },
    }));
    const result = await executeArtifactCode({
      fs: new FileSystemManager("skills-code"),
      executor: async ({ files }) => {
        expect(files?.[path].content).toBe("real artifact");
        expect(files?.["/skills/test/resource.txt"].content).toBe("resource");
        return { success: true, output: "ok", files: structuredClone(files) };
      },
      args: { code: "run" },
      extension: "py",
      mountSkills: true,
    });
    expect(result.success).toBe(true);
    expect(files.get(path)?.content).toBe("real artifact");
    expect(files.has("/skills/test/resource.txt")).toBe(false);
    expect(opfs.writeArtifact).not.toHaveBeenCalled();
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

describe("FileSystemManager revisions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function inMemoryWorkspace(initial: Array<[string, { content: string; contentType?: string }]> = []) {
    const files = new Map(initial);
    opfs.readArtifact.mockImplementation(async (_chatId: string, path: string) => files.get(path));
    opfs.writeArtifact.mockImplementation(
      async (_chatId: string, path: string, content: string, contentType?: string) => {
        files.set(path, { content, contentType });
      },
    );
    opfs.listArtifacts.mockImplementation(async () => [...files.keys()]);
    opfs.listArtifactEntries.mockImplementation(async () => [...files.keys()].map((path) => ({ path, size: 0 })));
    return files;
  }

  it("records who wrote a revision and why", async () => {
    inMemoryWorkspace();
    const fs = new FileSystemManager("chat");
    const origin = { actor: "assistant" as const, runId: "run-1", reason: "create" as const };

    await fs.createFile("/notes.md", "v1", "text/markdown", { origin });

    expect(opfs.archiveArtifactRevision).toHaveBeenLastCalledWith(
      "chat",
      expect.objectContaining({ path: "/notes.md", content: "v1", origin }),
    );
  });

  it("tags interpreter sync-backs as executions of the running turn", async () => {
    inMemoryWorkspace();
    const fs = new FileSystemManager("chat");
    const executor: SandboxExecutor = async () => ({
      success: true,
      output: "",
      files: { "/out.txt": { content: "done", contentType: "text/plain" } },
    });

    await executeArtifactCode({
      args: { code: "print(1)" },
      context: { runId: "run-9" },
      executor,
      extension: "py",
      fs,
    });

    expect(opfs.archiveArtifactRevision).toHaveBeenLastCalledWith(
      "chat",
      expect.objectContaining({
        path: "/out.txt",
        origin: { actor: "assistant", runId: "run-9", reason: "execution" },
      }),
    );
  });

  it("lists revisions newest first and marks the live file's entry as current", async () => {
    inMemoryWorkspace([["/notes.md", { content: "v2", contentType: "text/markdown" }]]);
    const live = await artifactRevision("v2", "text/markdown");
    opfs.listArtifactRevisionEntries.mockResolvedValue([
      { revision: live, createdAt: "2026-01-01T00:00:00.000Z", size: 2 },
      { revision: "sha256:other", createdAt: "2026-01-02T00:00:00.000Z", size: 2 },
      { revision: live, createdAt: "2026-01-03T00:00:00.000Z", size: 2 },
    ]);

    const listed = await new FileSystemManager("chat").listRevisions("/notes.md");

    expect(listed.map((entry) => [entry.createdAt, entry.current])).toEqual([
      ["2026-01-03T00:00:00.000Z", true],
      ["2026-01-02T00:00:00.000Z", false],
      ["2026-01-01T00:00:00.000Z", false],
    ]);
  });

  it("restores an archived revision as a new current revision", async () => {
    const files = inMemoryWorkspace([["/notes.md", { content: "v2", contentType: "text/markdown" }]]);
    opfs.loadArtifactRevision.mockResolvedValue({
      path: "/notes.md",
      revision: "sha256:old",
      content: "v1",
      contentType: "text/markdown",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const mutation = await new FileSystemManager("chat").restoreRevision("/notes.md", "sha256:old");

    expect(mutation).toMatchObject({ operation: "update", path: "/notes.md" });
    expect(files.get("/notes.md")?.content).toBe("v1");
    expect(opfs.archiveArtifactRevision).toHaveBeenLastCalledWith(
      "chat",
      expect.objectContaining({ content: "v1", origin: { actor: "user", reason: "restore" } }),
    );
  });

  it("rejects restoring a revision that was never archived", async () => {
    inMemoryWorkspace();
    opfs.loadArtifactRevision.mockResolvedValue(undefined);
    await expect(new FileSystemManager("chat").restoreRevision("/notes.md", "sha256:missing")).rejects.toThrow(
      "Revision not found",
    );
  });

  it("carries history to the destination of a rename", async () => {
    inMemoryWorkspace([["/old.md", { content: "v1", contentType: "text/markdown" }]]);
    await new FileSystemManager("chat").renameFile("/old.md", "/new.md", {
      origin: { actor: "assistant", reason: "rename" },
    });
    expect(opfs.copyArtifactRevisionHistory).toHaveBeenCalledWith("chat", "/old.md", "/new.md");
  });
});
