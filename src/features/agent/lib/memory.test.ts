import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import * as opfs from "@/shared/lib/opfs-core";
import { restoreFiles } from "@/shared/lib/opfs-restore";
import type { Message, Tool, ToolContext } from "@/shared/types/chat";
import { MemoryManager } from "./memoryManager";
import { bytes, memoryIndexes, memoryRevision, parseMemoryDocument, serializeMemoryDocument } from "./memoryDocument";
import { emptyMemoryState } from "./memoryState";
import { recallMemory, MEMORY_CONTEXT_MAX_BYTES } from "./memoryRecall";
import { mountMemoryFiles } from "./memoryFileMount";
import { enqueueMemoryLearning, processMemoryJob, type MemoryCandidates } from "./memoryLearning";
import { reconcileMemorySources } from "./memorySources";
import { migrateLegacyMemory, type LegacyMemoryNotes } from "./memoryMigration";

vi.mock("@/shared/config", () => ({ getConfig: () => ({ memory: {}, models: [], chat: {}, client: {} }) }));
const disk = new MemoryOpfs();
const manager = () => new MemoryManager("a");
const document = (body: string, metadata: Record<string, unknown> = {}) =>
  serializeMemoryDocument({ metadata: { type: "Reference", ...metadata }, body });
const settings = (extra = "") => `---\nname: Agent\nmemory: true\n${extra}---\n`;
const messages: Message[] = [
  { id: "u", runId: "run", role: "user", content: [{ type: "text", text: "In general please answer me in German." }] },
  { id: "a", runId: "run", role: "assistant", content: [{ type: "text", text: "I will use German." }] },
];
const saveChat = (value = messages) =>
  disk.put(
    "chats/chat/chat.json",
    JSON.stringify({
      id: "chat",
      title: "Chat",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      messages: value,
    }),
  );
const candidate = (body = "The user prefers German.", path = "preferences/language.md"): MemoryCandidates => ({
  notes: [
    {
      path,
      type: "Preference",
      title: "Language",
      description: "Preferred response language",
      body,
      tags: ["language"],
      scope: null,
      core: true,
      stale_after: null,
      source_ids: ["u"],
    },
  ],
});
const resultText = (result: Awaited<ReturnType<Tool["function"]>>) =>
  result.map((part) => (part.type === "text" ? part.text : "")).join("");
const fileTool = (
  tools: Tool[],
  name: string,
  args: Record<string, unknown>,
  context: ToolContext = { chatId: "chat", runId: "run" },
) =>
  tools
    .find((tool) => tool.name === `artifacts_${name}`)!
    .function(args, context)
    .then(resultText);

beforeEach(() => {
  vi.useFakeTimers();
  disk.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => disk.root } });
  disk.put("agents/a/AGENTS.md", settings());
  disk.put("agents/b/AGENTS.md", settings());
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("OKF notes and bounded retrieval", () => {
  it("preserves nested and unknown YAML, including block scalars and source metadata", () => {
    const original = `---\ntype: Decision\ntitle: 'Build: rules'\nsources:\n  - resource: https://example.com/spec\n    author: team:platform\nverified: {by: 'human:local', at: '2026-06-01T00:00:00Z'}\ncustom:\n  nested: [1, 2]\ndescription: |\n  First line.\n  Second line.\n---\n\nKeep this.\n`;
    const parsed = parseMemoryDocument(original);
    expect(parseMemoryDocument(serializeMemoryDocument(parsed))).toEqual(parsed);
    expect(parsed.metadata.sources).toEqual([{ resource: "https://example.com/spec", author: "team:platform" }]);
    expect(() => parseMemoryDocument("---\ntype: &a Reference\ntitle: *a\n---\nBody")).toThrow();
    expect(() => parseMemoryDocument("---\ntype: Reference\ntype: Preference\n---\nBody")).toThrow();
  });

  it("selects scoped, relevant notes and keeps stale data out of current answers", () => {
    const files = new Map([
      ["core.md", document("Respond concisely.", { core: true })],
      ["wingman.md", document("Use OPFS in Wingman.", { scope: "Wingman", title: "Wingman storage" })],
      ["other.md", document("Use SQL in AnotherProject.", { scope: "AnotherProject" })],
      ["expired.md", document("Wingman used old storage.", { stale_after: "2020-01-01T00:00:00Z" })],
      ["draft.md", document("Wingman unconfirmed proposal.", { status: "draft" })],
    ]);
    const snapshot = { files, state: emptyMemoryState() };
    const recall = recallMemory(snapshot, "Wingman storage");
    expect(recall).toContain("Respond concisely.");
    expect(recall).toContain("Use OPFS");
    expect(recall).not.toMatch(/AnotherProject|old storage|unconfirmed/);
    expect(recallMemory(snapshot, "historical Wingman storage")).toContain("historical, stale");
    files.delete("core.md");
    expect(recallMemory(snapshot, "recipe for pancakes")).toBe("");
  });

  it("bounds the complete context and index descriptions even with adversarial Unicode titles", () => {
    const files = new Map(
      Array.from({ length: 20 }, (_, i) => [
        `${i}.md`,
        document("🦋".repeat(4000), { core: i < 3, title: "語".repeat(4000), description: "語".repeat(4000) }),
      ]),
    );
    const snapshot = { files, state: emptyMemoryState() };
    const context = recallMemory(snapshot, "語");
    expect(bytes(context)).toBeLessThanOrEqual(MEMORY_CONTEXT_MAX_BYTES);
    expect(context).toContain("🦋");
    expect(bytes(memoryIndexes(files).get("index.md")!)).toBeLessThan(10000);
    expect(recallMemory(snapshot, "語", 12)).toBe("");
  });
});

describe("memory manager persistence", () => {
  it("keeps legacy user preferences available as bounded core context", async () => {
    disk.put(
      "agents/a/MEMORY.md",
      "## User Preferences\nPrefer German.\n\n## Project Context\nProject X uses a local database.",
    );
    const context = recallMemory(await manager().snapshot(), "Hello");
    expect(context).toContain("Prefer German");
    expect(context).not.toContain("Project X");
  });
  it("migrates large Unicode legacy memory once and generates indexes for all directories", async () => {
    const legacy = "Earlier preferences.\n" + "語🦋".repeat(2500);
    disk.put("agents/a/MEMORY.md", legacy);
    const first = await manager().snapshot();
    expect([...first.files.values()].map((text) => parseMemoryDocument(text).body).join("")).toBe(legacy);
    expect(await opfs.readText("agents/a/MEMORY.md")).toBeUndefined();
    expect(await opfs.readText("agents/a/memory/index.md")).toContain('okf_version: "0.2"');
    expect(await opfs.readText("agents/a/memory/legacy/index.md")).toContain("notes-1.md");
    const writes = disk.closed.length;
    expect((await manager().snapshot()).files).toEqual(first.files);
    expect(disk.closed).toHaveLength(writes);
  });

  it("retains the legacy original if any migration write fails", async () => {
    disk.put("agents/a/MEMORY.md", "Keep the original.");
    let failed = false;
    disk.beforeWrite = async (path) => {
      if (path === "agents/a/memory/index.md" && !failed) {
        failed = true;
        throw new Error("Quota");
      }
    };
    await expect(manager().snapshot()).rejects.toThrow("Quota");
    expect(await opfs.readText("agents/a/MEMORY.md")).toBe("Keep the original.");
    expect(await opfs.readText("agents/a/memory/legacy/notes-1.md")).toBeUndefined();
    await manager().snapshot();
    expect(await opfs.readText("agents/a/MEMORY.md")).toBeUndefined();
  });

  it("serializes independent managers and rejects stale rewrites", async () => {
    await Promise.all([manager().write("/.memory/one.md", "One"), manager().write("/.memory/two.md", "Two")]);
    const before = (await manager().snapshot()).files.get("one.md")!;
    const revision = await memoryRevision(before);
    await manager().write("/.memory/one.md", "Changed", revision);
    await expect(manager().write("/.memory/one.md", "Stale", revision)).rejects.toThrow("changed since");
    const index = await opfs.readText("agents/a/memory/index.md");
    expect(index).toContain("one.md");
    expect(index).toContain("two.md");
    expect((await new MemoryManager("b").snapshot()).files.size).toBe(0);
  });

  it("validates a batch before mutation and rolls back notes and indexes on I/O failure", async () => {
    await expect(
      manager().transaction(
        async ({ source }) =>
          source.writeBatch([
            { path: "/.memory/valid.md", content: "Valid" },
            { path: "/.memory/invalid.md", content: "---\ntitle: Missing type\n---\nOops" },
          ]),
        { writable: true },
      ),
    ).rejects.toThrow("requires a type");
    expect((await manager().snapshot()).files.size).toBe(0);
    const index = await opfs.readText("agents/a/memory/index.md");
    let failed = false;
    disk.beforeWrite = async (path) => {
      if (path.endsWith("memory/index.md") && !failed) {
        failed = true;
        throw new Error("Quota");
      }
    };
    await expect(manager().write("/.memory/new.md", "New")).rejects.toThrow("Quota");
    expect(await opfs.readText("agents/a/memory/new.md")).toBeUndefined();
    expect(await opfs.readText("agents/a/memory/index.md")).toBe(index);
  });

  it("preserves unknown metadata, clears stale verification, redacts credentials, and bounds all writers", async () => {
    await manager().write(
      "/.memory/note.md",
      document("Before", { custom: { nested: [1] }, verified: [{ by: "human:local", at: "2026-01-01T00:00:00Z" }] }),
    );
    const before = (await manager().snapshot()).files.get("note.md")!;
    await manager().write("/.memory/note.md", "After", await memoryRevision(before));
    const doc = parseMemoryDocument((await manager().snapshot()).files.get("note.md")!);
    expect(doc.metadata.custom).toEqual({ nested: [1] });
    expect(doc.metadata.verified).toBeUndefined();
    await expect(manager().write("/.memory/huge.md", "語".repeat(3000))).rejects.toThrow("8 KiB");
    await manager().write("/.memory/secret.md", "API_KEY=sk-1234567890abcdefghijklmnopqrstuvwx");
    expect((await manager().snapshot()).files.get("secret.md")).not.toContain("sk-1234567890");
    await expect(manager().write("/.memory/index.md", "Fake index")).rejects.toThrow("generated");
    await expect(manager().write("/.memory/../escape.md", "Escape")).rejects.toThrow();
  });

  it("moves topic folders, rebuilds indexes, and rejects writes after disable or agent deletion", async () => {
    await manager().write("/.memory/old/note.md", "A note");
    await manager().transaction(async ({ source }) => source.move("/.memory/old", "/.memory/new"), { writable: true });
    expect(await opfs.readText("agents/a/memory/old/index.md")).toBeUndefined();
    expect(await opfs.readText("agents/a/memory/new/index.md")).toContain("note.md");
    disk.put("agents/a/AGENTS.md", settings().replace("memory: true", "memory: false"));
    await expect(manager().write("/.memory/late.md", "Late")).rejects.toThrow("disabled");
    await opfs.deleteDirectory("agents/a");
    await expect(manager().write("/.memory/late.md", "Late")).rejects.toThrow("no longer exists");
  });

  it("rejects malformed/oversized imports before changing existing data and preserves OKF logs", async () => {
    await expect(
      restoreFiles(new Map([["agents/a/memory/broken.md", new Blob(["---\ntype: [bad]\n---\nBody"])]])),
    ).rejects.toThrow();
    expect(await opfs.readText("agents/a/memory/broken.md")).toBeUndefined();
    disk.put("agents/a/memory/log.md", "# Changes\n\n## 2026-09-19\n- Imported note.");
    await manager().snapshot();
    expect(await opfs.readText("agents/a/memory/log.md")).toContain("Imported note");
    expect(recallMemory(await manager().snapshot(), "Imported")).toBe("");
  });

  it("checks bundle capacity before import writes any files", async () => {
    const incoming = new Map(
      Array.from({ length: 257 }, (_, index) => [`agents/a/memory/${index}.md`, new Blob([document(`Note ${index}`)])]),
    );
    await expect(restoreFiles(incoming)).rejects.toThrow("256-note");
    expect(await opfs.readText("agents/a/memory/0.md")).toBeUndefined();
  });
});

describe("one-time model migration", () => {
  const output = (): LegacyMemoryNotes => ({
    notes: [
      {
        path: "preferences/language.md",
        type: "Preference",
        title: "Language",
        description: "General response language",
        body: "Prefer German.",
        tags: ["language"],
        core: true,
        scope: null,
        source_paths: ["legacy/notes-1.md"],
      },
    ],
  });

  it("retains readable fallbacks until the model splits them and checkpoints success across reloads", async () => {
    disk.put("agents/a/MEMORY.md", "## User Preferences\nPrefer German.");
    const fallback = await manager().snapshot();
    expect(fallback.state.migration?.paths).toEqual(["legacy/notes-1.md"]);
    expect(fallback.files.get("legacy/notes-1.md")).toContain("Prefer German");
    const extract = vi.fn().mockResolvedValue(output());
    await migrateLegacyMemory(manager(), "model", extract);
    const migrated = await manager().snapshot();
    expect([...migrated.files.keys()]).toEqual(["preferences/language.md"]);
    expect(migrated.state.migration).toBeUndefined();
    expect(await opfs.readText("agents/a/memory/index.md")).toContain("preferences/language.md");
    await migrateLegacyMemory(manager(), "model", extract);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("keeps fallbacks on incomplete output and failed persistence, and respects a concurrent edit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    disk.put("agents/a/MEMORY.md", "## User Preferences\nPrefer German.");
    const before = (await manager().snapshot()).files;
    await migrateLegacyMemory(manager(), "model", async () => ({
      notes: [{ ...output().notes[0], source_paths: [] }],
    }));
    expect((await manager().snapshot()).files).toEqual(before);
    let failed = false;
    disk.beforeWrite = async (path) => {
      if (path.endsWith("memory/index.md") && !failed) {
        failed = true;
        throw new Error("Quota");
      }
    };
    await migrateLegacyMemory(manager(), "model", async () => output());
    expect((await manager().snapshot()).files).toEqual(before);
    await migrateLegacyMemory(manager(), "model", async () => {
      await manager().write(
        "/.memory/legacy/notes-1.md",
        "Human correction",
        await memoryRevision(before.get("legacy/notes-1.md")!),
      );
      return output();
    });
    const after = await manager().snapshot();
    expect(after.files.get("legacy/notes-1.md")).toContain("Human correction");
    expect(after.files.has("preferences/language.md")).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("existing file tools at the memory mount", () => {
  it("supports memory with artifacts disabled, enforces explicit reads, and retains run provenance", async () => {
    const tools = mountMemoryFiles([], manager());
    expect(tools).toHaveLength(7);
    expect(await fileTool(tools, "create", { file_path: "/.memory/pref.md", content: "Prefer German." })).toContain(
      "success",
    );
    const note = parseMemoryDocument((await manager().snapshot()).files.get("pref.md")!);
    expect(note.metadata.sources).toEqual([{ resource: "wingman://chats/chat/runs/run" }]);
    const other = mountMemoryFiles([], manager());
    expect(await fileTool(other, "create", { file_path: "/.memory/pref.md", content: "Overwrite" })).toContain(
      "Read /.memory/pref.md",
    );
    expect(await fileTool(other, "create", { file_path: "/.memory/pref.md", content: "Retry without read" })).toContain(
      "Read /.memory/pref.md",
    );
    expect(await fileTool(other, "read", { file_path: "/.memory/pref.md" })).toContain("German");
    expect(
      await fileTool(other, "edit", {
        edits: [{ file_path: "/.memory/pref.md", old_string: "German", new_string: "English" }],
      }),
    ).toContain("success");
    expect(await fileTool(other, "create", { file_path: "/report.md", content: "Report" })).toContain("Only /.memory/");
  });

  it("isolates artifacts, refuses mixed batches and child writes, bounds search, and skips deliverable metadata", async () => {
    const base: Tool = {
      name: "artifacts_read",
      parameters: {},
      function: vi.fn().mockResolvedValue([{ type: "text", text: "ordinary artifact" }]),
    };
    const tools = mountMemoryFiles([base], manager());
    expect(await fileTool(tools, "read", { file_path: "/report.md" })).toBe("ordinary artifact");
    expect(
      await fileTool(tools, "edit", {
        edits: [
          { file_path: "/.memory/a.md", old_string: "", new_string: "Memory" },
          { file_path: "/report.md", old_string: "", new_string: "Report" },
        ],
      }),
    ).toContain("cannot span");
    const child = { invocationContext: { branch: "child" } } as unknown as ToolContext;
    expect(await fileTool(tools, "create", { file_path: "/.memory/a.md", content: "Memory" }, child)).toContain(
      "read-only",
    );
    const setMeta = vi.fn();
    await fileTool(tools, "create", { file_path: "/.memory/a.md", content: "Line useful\n".repeat(450) }, { setMeta });
    expect(setMeta).not.toHaveBeenCalled();
    const output = await fileTool(tools, "grep", { path: "/.memory", pattern: "Line", head_limit: 0 });
    expect(bytes(output)).toBeLessThanOrEqual(8192);
    expect(await fileTool(mountMemoryFiles([base]), "read", { file_path: "/.memory/a.md" })).toContain("disabled");
    expect(base.function).toHaveBeenCalledTimes(1);
  });
});

describe("incremental background learning", () => {
  it("persists a queue across manager instances, checkpoints no-ops, and avoids unchanged calls", async () => {
    saveChat();
    await enqueueMemoryLearning(manager(), "chat", "model", messages);
    const extract = vi.fn().mockResolvedValue({ notes: [] });
    expect(await processMemoryJob(manager(), extract)).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1);
    await enqueueMemoryLearning(manager(), "chat", "model", messages);
    expect(await processMemoryJob(manager(), extract)).toBe(false);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("records genuine source hashes, deactivates changed evidence, and never grants verification", async () => {
    saveChat();
    await enqueueMemoryLearning(manager(), "chat", "model", messages);
    await processMemoryJob(manager(), async () => candidate());
    const doc = parseMemoryDocument((await manager().snapshot()).files.get("preferences/language.md")!);
    expect(doc.metadata.generated).toMatchObject({ by: "wingman/learning" });
    expect(doc.metadata.verified).toBeUndefined();
    expect(doc.metadata.sources).toEqual([
      { resource: "wingman://chats/chat/messages/u", wingman_hash: expect.any(String) },
    ]);
    saveChat([{ ...messages[0], content: [{ type: "text", text: "I prefer French." }] }, messages[1]]);
    await reconcileMemorySources(manager());
    expect(recallMemory(await manager().snapshot(), "language")).toBe("");
    expect(
      parseMemoryDocument((await manager().snapshot()).files.get("preferences/language.md")!).metadata.status,
    ).toBe("draft");
  });

  it("does not resurrect a forgotten note or apply a response after a clear", async () => {
    saveChat();
    await enqueueMemoryLearning(manager(), "chat", "model", messages);
    await processMemoryJob(manager(), async () => candidate());
    await manager().remove("/.memory/preferences/language.md");
    const changed = [
      { ...messages[0], content: [{ type: "text" as const, text: "I still prefer German, generally." }] },
      messages[1],
    ];
    saveChat(changed);
    await enqueueMemoryLearning(manager(), "chat", "model", changed);
    await processMemoryJob(manager(), async () => candidate("The user prefers German.", "another-path.md"));
    expect((await manager().snapshot()).files.size).toBe(0);
    const newer = [{ ...changed[0], id: "new" }, messages[1]];
    saveChat(newer);
    await enqueueMemoryLearning(manager(), "chat", "model", newer);
    await processMemoryJob(manager(), async () => {
      await manager().remove("/.memory");
      return { notes: [{ ...candidate().notes[0], source_ids: ["new"] }] };
    });
    expect((await manager().snapshot()).files.size).toBe(0);
    expect((await manager().snapshot()).state.jobs).toHaveLength(0);
  });

  it("ignores unsupported evidence and source changes during a model call", async () => {
    saveChat();
    await enqueueMemoryLearning(manager(), "chat", "model", messages);
    await processMemoryJob(manager(), async () => ({ notes: [{ ...candidate().notes[0], source_ids: ["invented"] }] }));
    expect((await manager().snapshot()).files.size).toBe(0);
    const newer = [{ ...messages[0], id: "new" }, messages[1]];
    saveChat(newer);
    await enqueueMemoryLearning(manager(), "chat", "model", newer);
    await processMemoryJob(manager(), async () => {
      saveChat([]);
      return { notes: [{ ...candidate().notes[0], source_ids: ["new"] }] };
    });
    expect((await manager().snapshot()).files.size).toBe(0);
  });

  it("skips learning when memory is disabled and bounds retries", async () => {
    saveChat();
    disk.put("agents/a/AGENTS.md", settings().replace("memory: true", "memory: false"));
    await enqueueMemoryLearning(manager(), "chat", "model", messages);
    expect((await manager().transaction(async ({ state }) => state)).jobs).toHaveLength(0);
    disk.put("agents/a/AGENTS.md", settings());
    await manager().write("/.memory/manual.md", "Manual memories still work.");
    await enqueueMemoryLearning(manager(), "chat", "model", messages);
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 4; i++) await processMemoryJob(manager(), failing);
    expect(failing).toHaveBeenCalledTimes(3);
    expect((await manager().snapshot()).files.get("manual.md")).toContain("Manual");
    vi.restoreAllMocks();
  });
});
