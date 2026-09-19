import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import * as opfs from "@/shared/lib/opfs-core";
import { addMemory, type ComposedMemories } from "./memoryCompose";
import { parseMemoryDocument } from "./memoryDocument";
import { MemoryManager } from "./memoryManager";

vi.mock("@/shared/config", () => ({ getConfig: () => ({ models: [], chat: {} }) }));
const disk = new MemoryOpfs();
const manager = new MemoryManager("a");
const settings = "---\nname: Agent\nmemory: true\nmodel: text-model\n---\n";
const output = (): ComposedMemories => ({
  notes: [
    {
      path: "preferences/writing.md",
      type: "Preference",
      title: "Writing style",
      description: "Response preferences",
      body: "Prefer concise answers.",
      tags: ["writing"],
      scope: null,
      core: true,
    },
  ],
});

beforeEach(() => {
  disk.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => disk.root } });
  disk.put("agents/a/AGENTS.md", settings);
});
afterEach(() => vi.unstubAllGlobals());

describe("plain text memory additions", () => {
  it("organizes topics, redacts input, generates indexes, and preserves existing memories", async () => {
    await manager.write("/.memory/preferences/writing.md", "Earlier memory.");
    const secret = "sk-" + "a".repeat(32);
    const compose = vi.fn(async () => ({
      notes: [
        output().notes[0],
        {
          ...output().notes[0],
          path: "projects/wingman.md",
          title: "Wingman",
          scope: "Wingman",
          core: true,
          body: "Wingman stores data in the browser.",
        },
      ],
    }));
    const paths = await addMemory(
      manager,
      `Prefer concise answers. Wingman uses browser storage. Key: ${secret}`,
      compose,
    );
    expect(compose.mock.calls[0]).toEqual([
      "text-model",
      expect.stringContaining("[REDACTED_SECRET]"),
      expect.any(AbortSignal),
    ]);
    expect(JSON.stringify(compose.mock.calls)).not.toContain(secret);
    expect(paths).toEqual(["preferences/writing-2.md", "projects/wingman.md"]);
    const files = (await manager.snapshot()).files;
    expect(files.get("preferences/writing.md")).toContain("Earlier memory.");
    expect(parseMemoryDocument(files.get(paths[0])!).metadata).toMatchObject({
      core: true,
      generated: { by: "human:local" },
    });
    expect(parseMemoryDocument(files.get(paths[1])!).metadata).toMatchObject({ scope: "Wingman", core: false });
    expect(await opfs.readText("agents/a/memory/index.md")).toContain("writing-2.md");
    expect(await opfs.readText("agents/a/memory/projects/index.md")).toContain("wingman.md");
  });

  it("rejects empty, oversized, disabled, and model-less requests before calling the model", async () => {
    const compose = vi.fn(async () => output());
    await expect(addMemory(manager, " ", compose)).rejects.toThrow("Enter something");
    await expect(addMemory(manager, "語".repeat(3000), compose)).rejects.toThrow("shorter memory");
    disk.put("agents/a/AGENTS.md", settings.replace("memory: true", "memory: false"));
    await expect(addMemory(manager, "A useful fact.", compose)).rejects.toThrow("Enable memory");
    disk.put("agents/a/AGENTS.md", settings.replace("model: text-model\n", ""));
    await expect(addMemory(manager, "A useful fact.", compose)).rejects.toThrow("Choose a text model");
    expect(compose).not.toHaveBeenCalled();
  });

  it("leaves storage unchanged for refusals, invalid output, and a failed batch write", async () => {
    await manager.write("/.memory/original.md", "Keep this memory.");
    const before = (await manager.snapshot()).files;
    await expect(addMemory(manager, "Remember this.", async () => null)).rejects.toThrow("could not be organized");
    await expect(addMemory(manager, "Remember this.", async () => ({ notes: [] }))).rejects.toThrow();
    const invalid = output();
    invalid.notes.push({ ...invalid.notes[0], path: "index.md" });
    await expect(addMemory(manager, "Remember this.", async () => invalid)).rejects.toThrow("incomplete");
    let failed = false;
    disk.beforeWrite = async (path) => {
      if (!failed && path === "agents/a/memory/index.md") {
        failed = true;
        throw new Error("Quota exceeded");
      }
    };
    await expect(addMemory(manager, "Remember this.", async () => output())).rejects.toThrow("Quota exceeded");
    expect((await manager.snapshot()).files).toEqual(before);
  });

  it("does not save a late model result after a clear, disable, or cancellation", async () => {
    await expect(
      addMemory(manager, "Remember this.", async () => {
        await manager.remove("/.memory");
        return output();
      }),
    ).rejects.toThrow("Memory changed");
    expect((await manager.snapshot()).files.size).toBe(0);
    await expect(
      addMemory(manager, "Remember this.", async () => {
        disk.put("agents/a/AGENTS.md", settings.replace("memory: true", "memory: false"));
        return output();
      }),
    ).rejects.toThrow("disabled");
    disk.put("agents/a/AGENTS.md", settings);
    const controller = new AbortController();
    await expect(
      addMemory(
        manager,
        "Remember this.",
        async () => {
          controller.abort();
          return output();
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect((await manager.snapshot()).files.size).toBe(0);
  });
});
