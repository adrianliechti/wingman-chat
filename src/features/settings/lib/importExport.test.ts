import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import * as opfs from "@/shared/lib/opfs";
import { loadAgent } from "@/features/agent/lib/agentStorage";
import { parseAgentMd } from "@/features/agent/lib/agentMarkdown";
import { exportSingleAgentAsZip, importAgentsFromZip } from "./agentImportExport";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/utils", async (original) => ({ ...(await original<object>()), downloadBlob: download }));
const memory = new MemoryOpfs();
const zip = async (files: Record<string, string>) => {
  const archive = new JSZip();
  for (const [path, text] of Object.entries(files)) archive.file(path, text);
  return new Blob([await archive.generateAsync({ type: "arraybuffer" })]);
};
const agentMd = "---\nname: Test\nskills: [example]\n---\nInstructions";
beforeEach(() => {
  memory.reset();
  download.mockReset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});

describe("agent restore", () => {
  it.each(["AGENTS.md", "one/AGENTS.md", "agents/one/AGENTS.md"])(
    "accepts %s and preserves bundled skills",
    async (path) => {
      const prefix = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
      await importAgentsFromZip(
        await zip({
          [path]: agentMd,
          [`${prefix}skills/example/SKILL.md`]: "---\nname: example\ndescription: Example\n---\nBody",
          [`${prefix}skills/example/scripts/run.py`]: "print(1)",
        }),
      );
      const [entry] = await opfs.readIndex("agents");
      expect(await loadAgent(entry.id)).toMatchObject({ name: "Test", skills: ["example"] });
      expect(await opfs.readText("skills/example/scripts/run.py")).toBe("print(1)");
      expect((await opfs.readIndex("skills"))[0].title).toBe("example");
    },
  );

  it.each(["AGENTS.md", "AGENT.md", "agent.json", "one/AGENT.md", "agents/one/agent.json"])(
    "accepts a %s definition from an older export",
    async (path) => {
      const result = await importAgentsFromZip(
        await zip({
          [path]: path.endsWith(".json") ? JSON.stringify({ name: "Test", instructions: "Instructions" }) : agentMd,
        }),
      );
      expect(result.skipped).toEqual([]);
      const [entry] = await opfs.readIndex("agents");
      expect(await loadAgent(entry.id)).toMatchObject({ name: "Test", instructions: "Instructions" });
    },
  );

  it("rejects an archive without any agent definition before writing", async () => {
    await expect(importAgentsFromZip(await zip({ "repositories/one/repository.json": "{}" }))).rejects.toThrow(
      "expected an AGENTS.md, AGENT.md or agent.json definition",
    );
    expect(memory.files.size).toBe(0);
  });

  it("reports an agent folder that carries no definition instead of dropping it", async () => {
    const result = await importAgentsFromZip(
      await zip({
        "agents/good/AGENTS.md": agentMd,
        "agents/orphan/servers.json": "[]",
        "agents/orphan/files/file/content.txt": "Source",
      }),
    );
    expect(result.skipped).toEqual([{ path: "agents/orphan", reason: expect.stringContaining("No AGENTS.md") }]);
    expect(await loadAgent("good")).toMatchObject({ name: "Test" });
    expect(await opfs.readText("agents/orphan/servers.json")).toBeUndefined();
  });

  it("rejects standalone JSON imports before writing", async () => {
    await expect(
      importAgentsFromZip(new Blob([JSON.stringify({ repositories: [{ name: "Old" }] })])),
    ).rejects.toThrow();
    expect(memory.files.size).toBe(0);
  });

  it("imports healthy agents when another agent contains malformed JSON", async () => {
    memory.put("agents/broken/AGENTS.md", "---\nname: Existing\n---\nKeep");
    const result = await importAgentsFromZip(
      await zip({
        "agents/broken/AGENTS.md": agentMd,
        "agents/broken/servers.json": "{broken",
        "agents/good/AGENTS.md": agentMd,
        "agents/good/servers.json": "[]",
      }),
    );
    expect(result.skipped).toEqual([
      { path: "agents/broken/servers.json", reason: expect.stringContaining("Invalid JSON") },
    ]);
    expect(await loadAgent("broken")).toMatchObject({ name: "Existing" });
    expect(await loadAgent("good")).toMatchObject({ name: "Test" });
  });

  it.each(["AGENT.md", "agent.json"])(
    "replaces a newer saved definition when importing an older %s definition",
    async (definition) => {
      memory.put("agents/one/AGENTS.md", "---\nname: Existing\n---\nKeep");
      memory.put("agents/one/AGENT.md", "---\nname: Also existing\n---\nKeep");
      await importAgentsFromZip(
        await zip({
          [`agents/one/${definition}`]:
            definition === "agent.json"
              ? JSON.stringify({ name: "Imported", instructions: "Updated" })
              : "---\nname: Imported\n---\nUpdated",
        }),
      );
      expect(await loadAgent("one")).toMatchObject({ name: "Imported", instructions: "Updated" });
    },
  );

  it("restores the saved definition formats when a legacy import fails", async () => {
    memory.put("agents/one/AGENTS.md", "---\nname: Existing\n---\nKeep");
    memory.put("agents/one/AGENT.md", "---\nname: Also existing\n---\nKeep");
    const saved = new Map(memory.files);
    let failed = false;
    memory.beforeWrite = async (path) => {
      if (path === "agents/index.json" && !failed) {
        failed = true;
        throw new Error("Index write failed");
      }
    };
    await expect(
      importAgentsFromZip(await zip({ "agents/one/agent.json": JSON.stringify({ name: "Imported" }) })),
    ).rejects.toThrow("Index write failed");
    expect(memory.files).toEqual(saved);
  });

  it.each([
    [],
    { name: 42 },
    { name: "Test", instructions: {} },
    { name: "Test", tools: "internet" },
    { name: "Test", skills: [1] },
    { name: "Test", servers: {} },
  ])("rejects malformed legacy agent metadata before replacing saved definitions: %j", async (definition) => {
    memory.put("agents/one/AGENTS.md", "---\nname: Existing\n---\nKeep");
    const saved = new Map(memory.files);
    await expect(
      importAgentsFromZip(await zip({ "agents/one/agent.json": JSON.stringify(definition) })),
    ).rejects.toThrow("Invalid agent definition");
    expect(memory.files).toEqual(saved);
  });

  it.each(["AGENTS.md", "AGENT.md", "agent.json"])(
    "exports saved %s agents as importable current ZIPs",
    async (definition) => {
      const servers = [{ id: "server", name: "Server", url: "https://example.test", enabled: true }];
      const settings = {
        model: "saved-model",
        effort: "high",
        verbosity: "low",
        plugins: ["plugin"],
        tools: ["internet"],
        memory: true,
      };
      memory.put(
        `agents/original/${definition}`,
        definition === "agent.json"
          ? JSON.stringify({ name: "Test", instructions: "Instructions", skills: ["example"], servers, ...settings })
          : agentMd.replace(
              "\n---\n",
              "\nmodel: saved-model\neffort: high\nverbosity: low\nplugins: [plugin]\ntools: [internet]\nmemory: true\n---\n",
            ),
      );
      if (definition !== "agent.json") memory.put("agents/original/servers.json", JSON.stringify(servers));
      memory.put(
        "agents/original/files/file/metadata.json",
        JSON.stringify({ name: "x.txt", uploadedAt: "2020-01-01", status: "completed", progress: 100 }),
      );
      memory.put("agents/original/files/file/content.txt", "Source");
      memory.put("skills/example/SKILL.md", "---\nname: example\ndescription: Example\n---\nBody");
      const original = await loadAgent("original");
      const saved = new Map(memory.files);
      await exportSingleAgentAsZip("original");
      expect(memory.files).toEqual(saved);
      const blob = download.mock.calls[0][0] as Blob;
      const archive = await JSZip.loadAsync(await blob.arrayBuffer());
      expect(archive.file("AGENT.md")).toBeNull();
      expect(archive.file("agent.json")).toBeNull();
      expect(archive.file("AGENTS.md")).not.toBeNull();
      expect(parseAgentMd(await archive.file("AGENTS.md")!.async("string"))).toMatchObject(settings);
      memory.reset();
      await importAgentsFromZip(blob);
      const [entry] = await opfs.readIndex("agents");
      expect(entry.id).not.toBe("original");
      expect(await loadAgent(entry.id)).toEqual({ ...original, id: entry.id });
      expect(await loadAgent(entry.id)).toMatchObject(settings);
      expect((await opfs.readIndex("skills"))[0].title).toBe("example");
    },
  );
});

// Archives the app produced before the native-transcript migration must keep
// importing: the formats below are the ones the previous importers accepted.
describe("historical archive layouts", () => {
  const chat = { id: "one", created: "2026-09-01", updated: "2026-09-02", model: null, messages: [] };
  const skill = "---\nname: example\ndescription: Example\n---\nBody";

  it.each(["chat.json", "one/chat.json", "chats/one/chat.json", "backup/chats/one/chat.json"])(
    "restores a chat export stored as %s",
    async (path) => {
      await opfs.importFolderFromZip("/", await zip({ [path]: JSON.stringify(chat) }));
      expect(await opfs.readJson("chats/one/chat.json")).toEqual(chat);
      expect((await opfs.readIndex("chats")).map((entry) => entry.id)).toEqual(["one"]);
    },
  );

  it("gives a flat chat without an id a new one", async () => {
    const { id, ...anonymous } = chat;
    expect(id).toBe("one");
    await opfs.importFolderFromZip("/", await zip({ "chat.json": JSON.stringify(anonymous) }));
    const [entry] = await opfs.readIndex("chats");
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["AGENTS.md", "AGENT.md", "agent.json", "one/AGENTS.md", "one/AGENT.md", "one/agent.json"])(
    "restores an agent export stored as %s",
    async (path) => {
      const definition = path.endsWith(".json")
        ? JSON.stringify({ name: "Test", instructions: "Instructions" })
        : agentMd;
      await opfs.importFolderFromZip("/", await zip({ [path]: definition, "skills/example/SKILL.md": skill }));
      const [entry] = await opfs.readIndex("agents");
      expect(await loadAgent(entry.id)).toMatchObject({ name: "Test", instructions: "Instructions" });
      expect((await opfs.readIndex("skills"))[0].title).toBe("example");
    },
  );

  it("keeps blobs and artifacts of a flat single-chat export with the chat", async () => {
    await opfs.importFolderFromZip(
      "/",
      await zip({
        "chat.json": JSON.stringify(chat),
        "blobs/sha256-a.bin": "bytes",
        "artifacts/nested/report.html": "<h1>Report</h1>",
      }),
    );
    expect(await opfs.readText("chats/one/blobs/sha256-a.bin")).toBe("bytes");
    expect(await opfs.readText("chats/one/artifacts/nested/report.html")).toBe("<h1>Report</h1>");
  });

  it("keeps servers, files and bundled skills of a flat single-agent export with the agent", async () => {
    await opfs.importFolderFromZip(
      "/",
      await zip({
        "AGENTS.md": agentMd,
        "servers.json": "[]",
        "files/file/metadata.json": JSON.stringify({ name: "x.txt", uploadedAt: "2026-09-01", status: "completed" }),
        "files/file/content.txt": "Source",
        "skills/example/SKILL.md": skill,
      }),
    );
    const [entry] = await opfs.readIndex("agents");
    expect(await opfs.readText(`agents/${entry.id}/files/file/content.txt`)).toBe("Source");
    expect(await opfs.readJson(`agents/${entry.id}/servers.json`)).toEqual([]);
    expect(await opfs.readText("skills/example/SKILL.md")).toBe(skill);
  });

  it("keeps a chat export and an unrelated folder apart", async () => {
    await opfs.importFolderFromZip(
      "/",
      await zip({ "one/chat.json": JSON.stringify(chat), "notes/todo.txt": "unrelated" }),
    );
    expect(await opfs.listDirectories("chats")).toEqual(["one"]);
    expect(await opfs.readText("notes/todo.txt")).toBe("unrelated");
  });

  it("restores a flat skill under its declared name with its resources", async () => {
    await opfs.importFolderFromZip("/", await zip({ "SKILL.md": skill, "scripts/run.py": "print(1)" }));
    expect(await opfs.readText("skills/example/SKILL.md")).toBe(skill);
    expect(await opfs.readText("skills/example/scripts/run.py")).toBe("print(1)");
    expect((await opfs.readIndex("skills"))[0].title).toBe("example");
  });

  it("leaves a folder with conflicting record definitions in place beside a flat record", async () => {
    await opfs.importFolderFromZip(
      "/",
      await zip({
        "chat.json": JSON.stringify(chat),
        "mixed/chat.json": JSON.stringify(chat),
        "mixed/AGENTS.md": agentMd,
      }),
    );
    expect(await opfs.readText("mixed/AGENTS.md")).toBe(agentMd);
    expect(await opfs.readText("chats/one/mixed/AGENTS.md")).toBeUndefined();
  });

  it("rejects inferred paths that collide with collection paths before writing", async () => {
    await expect(
      opfs.importFolderFromZip(
        "/",
        await zip({ "one/chat.json": JSON.stringify(chat), "chats/one/chat.json": JSON.stringify(chat) }),
      ),
    ).rejects.toThrow("Conflicting archive paths");
    expect(memory.files.size).toBe(0);
  });

  it("skips a malformed flat chat and restores healthy collection records", async () => {
    const result = await opfs.importFolderFromZip(
      "/",
      await zip({ "chat.json": "{broken", "blobs/a.bin": "bytes", "chats/one/chat.json": JSON.stringify(chat) }),
    );
    expect(result.skipped).toEqual([
      { path: expect.stringMatching(/^chats\/[^/]+\/chat.json$/), reason: expect.any(String) },
    ]);
    expect(await opfs.listDirectories("chats")).toEqual(["one"]);
    expect(await opfs.readJson("chats/one/chat.json")).toEqual(chat);
  });

  it("rejects a flat chat id that contains a path separator before writing", async () => {
    await expect(
      opfs.importFolderFromZip("/", await zip({ "chat.json": JSON.stringify({ ...chat, id: "one/nested" }) })),
    ).rejects.toThrow("Invalid chat id");
    expect(memory.files.size).toBe(0);
  });

  it("preserves filenames inherited from Object.prototype in ordinary archives", async () => {
    await opfs.importFolderFromZip("/", await zip({ "notes/toString": "ordinary file" }));
    expect(await opfs.readText("notes/toString")).toBe("ordinary file");
  });
});
