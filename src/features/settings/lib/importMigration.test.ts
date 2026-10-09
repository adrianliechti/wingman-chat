import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import * as opfs from "@/shared/lib/opfs";
import { loadChat } from "@/features/chat/lib/chatStorage";
import { loadAgent } from "@/features/agent/lib/agentStorage";
import { importAgentsFromZip } from "./agentImportExport";

vi.mock("@/shared/config", () => ({ getConfig: () => ({ chat: {} }) }));
vi.mock("@/shared/lib/utils", async (original) => ({
  ...(await original<object>()),
  readAsDataURL: async (blob: Blob) =>
    `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`,
}));
const memory = new MemoryOpfs();
const md = "---\nname: Historical\nskills: [example]\n---\nInstructions";
const skill = "---\nname: example\ndescription: Example\n---\nBody";
const legacy = {
  id: "one",
  created: "2026-03-01",
  updated: "2026-03-02",
  model: null,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Hello" },
        { type: "image", data: "blob:old-image", contentType: "image/png" },
      ],
    },
    { role: "assistant", content: [{ type: "tool_call", id: "call", name: "read", arguments: "{}" }] },
    {
      role: "user",
      content: [
        { type: "tool_result", id: "call", name: "read", arguments: "{}", result: [{ type: "text", text: "Read" }] },
      ],
    },
    { role: "assistant", content: [{ type: "text", text: "Done" }] },
  ],
};
const zip = async (files: Record<string, string>) => {
  const archive = new JSZip();
  for (const [path, text] of Object.entries(files)) archive.file(path, text);
  return new Blob([await archive.generateAsync({ type: "arraybuffer" })]);
};
const snapshotFiles = async () =>
  new Map(
    await Promise.all(
      [...memory.files].map(
        async ([path, blob]) => [path, Buffer.from(await blob.arrayBuffer()).toString("base64")] as const,
      ),
    ),
  );
beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});

describe("mixed and partial historical imports", () => {
  const fileMeta = (name: string) =>
    JSON.stringify({ name, uploadedAt: "2026-03-01", status: "completed", progress: 100 });

  it.each(["settings", "agents"])(
    "%s import preserves a single agent folder's identity when it has bundled skills",
    async (route) => {
      const archive = await zip({ "one/AGENT.md": md, "one/skills/example/SKILL.md": skill });
      for (let attempt = 0; attempt < 2; attempt++) {
        await (route === "settings" ? opfs.importFolderFromZip("/", archive) : importAgentsFromZip(archive));
      }
      expect((await opfs.readIndex("agents")).map((entry) => entry.id)).toEqual(["one"]);
      expect(await loadAgent("one")).toMatchObject({ name: "Historical", skills: ["example"] });
      expect(await opfs.readText("skills/example/SKILL.md")).toBe(skill);
    },
  );

  it.each(["settings", "agents"])("%s import skips bundled skills of an agent with malformed JSON", async (route) => {
    memory.put("skills/example/SKILL.md", `${skill}\nLocal`);
    const saved = await snapshotFiles();
    const archive = await zip({
      "agents/broken/agent.json": "{broken",
      "agents/broken/skills/example/SKILL.md": skill,
    });
    const result = await (route === "settings" ? opfs.importFolderFromZip("/", archive) : importAgentsFromZip(archive));
    expect(result.restoredFiles).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(await snapshotFiles()).toEqual(saved);
  });

  it.each(["settings", "agents"])("%s import ignores conflicting skills from a skipped agent", async (route) => {
    const archive = await zip({
      "agents/broken/agent.json": "{broken",
      "agents/broken/skills/example/SKILL.md": `${skill}\nBroken`,
      "agents/good/AGENTS.md": md,
      "agents/good/skills/example/SKILL.md": skill,
    });
    const result = await (route === "settings" ? opfs.importFolderFromZip("/", archive) : importAgentsFromZip(archive));
    expect(result.skipped).toHaveLength(1);
    expect(await opfs.readText("skills/example/SKILL.md")).toBe(skill);
    expect(await loadAgent("good")).toMatchObject({ name: "Historical" });
  });

  it.each(["settings", "agents"])("%s import merges older attached files into local membership", async (route) => {
    memory.put("agents/one/AGENTS.md", md);
    memory.put("agents/one/files/index.json", '["local"]');
    memory.put("agents/one/files/local/metadata.json", fileMeta("local.txt"));
    memory.put("agents/one/files/local/content.txt", "Local");
    memory.put("agents/one/files/orphan/metadata.json", fileMeta("orphan.txt"));
    const archive = await zip({
      "agents/one/agent.json": JSON.stringify({ name: "Imported" }),
      "agents/one/files/imported/metadata.json": fileMeta("imported.txt"),
      "agents/one/files/imported/content.txt": "Imported",
    });
    await (route === "settings" ? opfs.importFolderFromZip("/", archive) : importAgentsFromZip(archive));
    expect(await opfs.readJson("agents/one/files/index.json")).toEqual(["local", "imported"]);
    expect((await loadAgent("one"))?.files).toMatchObject([
      { id: "local", text: "Local" },
      { id: "imported", text: "Imported" },
    ]);
  });

  it("honors an explicitly supplied file index", async () => {
    memory.put("agents/one/files/index.json", '["local"]');
    memory.put("agents/one/files/local/metadata.json", fileMeta("local.txt"));
    await importAgentsFromZip(
      await zip({
        "agents/one/agent.json": JSON.stringify({ name: "Imported" }),
        "agents/one/files/index.json": "[]",
        "agents/one/files/imported/metadata.json": fileMeta("imported.txt"),
      }),
    );
    expect(await opfs.readJson("agents/one/files/index.json")).toEqual([]);
    expect((await loadAgent("one"))?.files).toBeUndefined();
  });

  it("keeps a recovery copy of JSON fields the current definition cannot represent", async () => {
    const original = JSON.stringify({
      name: "Imported",
      instructions: "  Keep my whitespace  ",
      futureSetting: { custom: [1, 2] },
      effort: "future-level",
    });
    await importAgentsFromZip(await zip({ "agents/one/agent.json": original }));
    expect(await opfs.readText("agents/one/agent.legacy.json")).toBe(original);
    expect(await loadAgent("one")).toMatchObject({ name: "Imported" });
  });

  it("does not let an unknown legacy effort or verbosity inject definition fields", async () => {
    await importAgentsFromZip(
      await zip({
        "agents/one/agent.json": JSON.stringify({
          name: "Imported",
          tools: [],
          effort: "high\ntools: [internet]",
          verbosity: "low\nname: Injected",
        }),
      }),
    );
    expect(await loadAgent("one")).toMatchObject({ name: "Imported", tools: [] });
  });

  it("does not remove the collection index when importing a chat whose id is index", async () => {
    memory.put("chats/broken/chat.json", "{broken");
    memory.put("chats/index.json", JSON.stringify([{ id: "broken", title: "Keep", updated: "2026-03-01" }]));
    await opfs.importFolderFromZip(
      "/",
      await zip({ "chats/index/chat.json": JSON.stringify({ ...legacy, id: "index" }) }),
    );
    expect(await opfs.readIndex("chats")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "broken", title: "Keep" }),
        expect.objectContaining({ id: "index" }),
      ]),
    );
  });

  it.each(["settings", "agents"])("%s import rejects same-size conflicting binary skill resources", async (route) => {
    const archive = await zip({
      "agents/one/AGENTS.md": md,
      "agents/one/skills/example/SKILL.md": skill,
      "agents/one/skills/example/data.bin": "AAAA",
      "skills/example/data.bin": "BBBB",
    });
    await expect(
      route === "settings" ? opfs.importFolderFromZip("/", archive) : importAgentsFromZip(archive),
    ).rejects.toThrow("Conflicting archive paths");
    expect(memory.files.size).toBe(0);
  });

  it.each([false, true])(
    "rejects ambiguous agent roots instead of overwriting one (prefixed first: %s)",
    async (prefixedFirst) => {
      const entries: [string, string][] = [
        ["agents/one/AGENTS.md", md],
        ["one/AGENTS.md", "---\nname: Different\n---\nDifferent"],
      ];
      await expect(
        importAgentsFromZip(await zip(Object.fromEntries(prefixedFirst ? entries : entries.reverse()))),
      ).rejects.toThrow("Conflicting archive paths");
      expect(memory.files.size).toBe(0);
    },
  );

  it("imports flat and collection agents together without nesting the collection under the flat agent", async () => {
    const result = await importAgentsFromZip(
      await zip({
        "AGENT.md": "---\nname: Flat\n---\nFlat",
        "agents/one/AGENTS.md": md,
        "agents/one/skills/example/SKILL.md": skill,
      }),
    );
    expect(result.skipped).toEqual([]);
    const agents = await Promise.all((await opfs.readIndex("agents")).map((entry) => loadAgent(entry.id)));
    expect(agents.map((agent) => agent?.name)).toEqual(expect.arrayContaining(["Flat", "Historical"]));
    expect(agents).toHaveLength(2);
    expect(await opfs.readText("skills/example/SKILL.md")).toBe(skill);
    expect([...memory.files.keys()].some((path) => /^agents\/[^/]+\/agents\//.test(path))).toBe(false);
  });

  it.each([
    "agents/one/AGENTS.md",
    "agents/one/agent.legacy.json",
    "agents/one/servers.json",
    "agents/one/files/index.json",
    "chats/one/chat.json",
    "agents/index.json",
    "chats/index.json",
    "skills/index.json",
  ])("restores exact bytes and membership after a migration write fails at %s", async (failedPath) => {
    memory.put("agents/one/AGENTS.md", md);
    memory.put("agents/one/AGENT.md", "---\nname: Older\n---\nOlder");
    memory.put("agents/one/agent.json", JSON.stringify({ name: "Oldest" }));
    memory.put("agents/one/agent.legacy.json", '{"unknown":"Keep"}');
    memory.put("agents/one/servers.json", '[{"id":"existing"}]');
    memory.put("agents/one/files/index.json", '["local"]');
    memory.put("agents/one/files/local/metadata.json", fileMeta("local.txt"));
    memory.put("agents/one/files/local/embeddings.bin", new Blob([new Float32Array([2, 0.5, -1]).buffer]));
    memory.put("chats/one/chat.json", JSON.stringify({ ...legacy, title: "Existing" }));
    memory.put("chats/one.json", JSON.stringify({ ...legacy, title: "Older" }));
    const saved = await snapshotFiles();
    const directories = new Set(memory.directories);
    let failed = false;
    memory.beforeWrite = async (path) => {
      if (path === failedPath && !failed) {
        failed = true;
        throw new Error("Injected write failure");
      }
    };
    await expect(
      opfs.importFolderFromZip(
        "/",
        await zip({
          "agents/one/agent.json": JSON.stringify({ name: "Imported", servers: [] }),
          "agents/one/files/imported/metadata.json": fileMeta("imported.txt"),
          "agents/one/files/imported/content.txt": "Imported",
          "agents/one/skills/example/SKILL.md": skill,
          "chats/one.json": JSON.stringify(legacy),
        }),
      ),
    ).rejects.toThrow("Injected write failure");
    expect(failed).toBe(true);
    expect(await snapshotFiles()).toEqual(saved);
    expect(memory.directories).toEqual(directories);
  });
});

it.each(["chat.json", "one/chat.json", "chats/one/chat.json", "backup/chats/one/chat.json"])(
  "opens populated historical chat layout %s with media and tools",
  async (path) => {
    const prefix = path.slice(0, -"chat.json".length);
    await opfs.importFolderFromZip(
      "/",
      await zip({
        [path]: JSON.stringify(legacy),
        [`${prefix}blobs/old-image.bin`]: "image-bytes",
        [`${prefix}artifacts/a.txt`]: "Artifact",
      }),
    );
    const chat = await loadChat("one");
    expect(chat?.messages[0].parts).toMatchObject([
      { type: "text", content: "Hello" },
      {
        type: "image",
        source: { type: "data", value: Buffer.from("image-bytes").toString("base64"), mimeType: "image/png" },
      },
    ]);
    expect(chat?.messages[1].parts.map((part) => part.type)).toEqual(["tool-call", "tool-result"]);
    expect(chat?.messages.at(-1)?.parts).toMatchObject([{ type: "text", content: "Done" }]);
    expect(await opfs.readText("chats/one/artifacts/a.txt")).toBe("Artifact");
    expect(await opfs.readJson("chats/one/chat.legacy.json")).toEqual(legacy);
  },
);

it("agent importer restores the March exporter layout including nested bundled skills", async () => {
  await importAgentsFromZip(
    await zip({
      "agents/one/AGENTS.md": md,
      "agents/one/skills/example/SKILL.md": skill,
      "agents/one/skills/example/scripts/run.py": "print(1)",
    }),
  );
  expect(await loadAgent("one")).toMatchObject({ name: "Historical", skills: ["example"] });
  expect(await opfs.readText("skills/example/scripts/run.py")).toBe("print(1)");
});

it.each(["one", "agents/one"])(
  "settings restore preserves nested bundled skills from historical agent layout %s",
  async (root) => {
    await opfs.importFolderFromZip(
      "/",
      await zip({
        [`${root}/AGENTS.md`]: md,
        [`${root}/skills/example/SKILL.md`]: skill,
        [`${root}/skills/example/scripts/run.py`]: "print(1)",
        "agents/two/AGENTS.md": "---\nname: Other\n---\nOther",
      }),
    );
    expect(await loadAgent("one")).toMatchObject({ name: "Historical", skills: ["example"] });
    expect(await opfs.readText("skills/example/scripts/run.py")).toBe("print(1)");
  },
);

it("restoring a historical flat chat replaces a newer local copy of the same chat", async () => {
  memory.put(
    "chats/one/chat.json",
    JSON.stringify({
      version: 2,
      id: "one",
      created: "2026-03-01",
      updated: "2026-10-01",
      model: null,
      messages: [{ id: "current", role: "user", parts: [{ type: "text", content: "Current" }] }],
    }),
  );
  await opfs.importFolderFromZip("/", await zip({ "chats/one.json": JSON.stringify(legacy) }));
  expect((await loadChat("one", false))?.messages[0].parts[0]).toMatchObject({ type: "text", content: "Hello" });
  expect(await opfs.readJson("chats/one/chat.json")).toEqual(legacy);
  expect(await opfs.readText("chats/one.json")).toBeUndefined();
});

it("settings restore keeps an anonymous flat chat openable", async () => {
  const { id: _id, ...anonymous } = legacy;
  await opfs.importFolderFromZip("/", await zip({ "chat.json": JSON.stringify(anonymous) }));
  const [entry] = await opfs.readIndex("chats");
  expect((await loadChat(entry.id, false))?.id).toBe(entry.id);
});

describe("import migration", () => {
  const server = {
    id: "imported",
    name: "Imported MCP",
    description: "Server",
    url: "https://imported.test",
    enabled: true,
  };
  const existingServer = { ...server, id: "existing", url: "https://existing.test" };

  it.each(["AGENT.md", "agent.json"])("stores imported %s as a current agent definition", async (definition) => {
    const settings = {
      model: "saved-model",
      effort: "high",
      verbosity: "low",
      plugins: ["plugin"],
      tools: ["internet"],
      memory: true,
    };
    const imported =
      definition === "agent.json"
        ? JSON.stringify({ name: "Historical", instructions: "Instructions", skills: ["example"], ...settings })
        : md.replace(
            "\n---\n",
            "\nmodel: saved-model\neffort: high\nverbosity: low\nplugins: [plugin]\ntools: [internet]\nmemory: true\n---\n",
          );
    await importAgentsFromZip(await zip({ [`agents/one/${definition}`]: imported }));
    expect(await loadAgent("one")).toMatchObject({
      name: "Historical",
      instructions: "Instructions",
      skills: ["example"],
      ...settings,
    });
    expect(await opfs.readText("agents/one/AGENTS.md")).toBeDefined();
    expect(await opfs.readText("agents/one/AGENT.md")).toBeUndefined();
    expect(await opfs.readText("agents/one/agent.json")).toBeUndefined();
  });

  it.each(["settings", "agents"])(
    "%s import separates inline legacy servers, including an empty list",
    async (route) => {
      for (const servers of [[], [server]]) {
        memory.put("agents/one/AGENTS.md", "---\nname: Existing\n---\nCurrent");
        memory.put("agents/one/servers.json", JSON.stringify([existingServer]));
        const archive = await zip({ "agents/one/agent.json": JSON.stringify({ name: "Imported", servers }) });
        if (route === "settings") await opfs.importFolderFromZip("/", archive);
        else await importAgentsFromZip(archive);
        expect(await loadAgent("one")).toMatchObject({ name: "Imported", servers });
        expect(await opfs.readJson("agents/one/servers.json")).toEqual(servers);
        expect(await opfs.readText("agents/one/AGENTS.md")).toBeDefined();
      }
    },
  );

  it("preserves local servers when a partial legacy definition does not specify them", async () => {
    memory.put("agents/one/servers.json", JSON.stringify([existingServer]));
    await importAgentsFromZip(await zip({ "agents/one/agent.json": JSON.stringify({ name: "Imported" }) }));
    expect(await loadAgent("one")).toMatchObject({ name: "Imported", servers: [existingServer] });
  });

  it("preserves a legacy servers sidecar when no servers are inline", async () => {
    await importAgentsFromZip(
      await zip({
        "agents/one/agent.json": JSON.stringify({ name: "Imported" }),
        "agents/one/servers.json": JSON.stringify([server]),
      }),
    );
    expect(await loadAgent("one")).toMatchObject({ name: "Imported", servers: [server] });
  });

  it("prefers a supplied current definition over older definitions and inline servers", async () => {
    await importAgentsFromZip(
      await zip({
        "agents/one/AGENTS.md": md,
        "agents/one/agent.json": JSON.stringify({ name: "Obsolete", servers: [existingServer] }),
        "agents/one/servers.json": JSON.stringify([server]),
      }),
    );
    expect(await loadAgent("one")).toMatchObject({ name: "Historical", servers: [server] });
  });

  it.each([false, true])(
    "prefers the supplied folder chat when both layouts are present (flat first: %s)",
    async (flatFirst) => {
      const current = { ...legacy, messages: [{ role: "user", content: [{ type: "text", text: "Authoritative" }] }] };
      const entries: [string, string][] = [
        ["chats/one.json", JSON.stringify(legacy)],
        ["chats/one/chat.json", JSON.stringify(current)],
      ];
      await opfs.importFolderFromZip("/", await zip(Object.fromEntries(flatFirst ? entries : entries.reverse())));
      expect(await opfs.readJson("chats/one/chat.json")).toEqual(current);
      expect(await opfs.readText("chats/one.json")).toBeUndefined();
    },
  );

  it("rolls back migrated definitions, servers and chat layouts on an index write failure", async () => {
    memory.put("agents/one/AGENTS.md", "---\nname: Existing\n---\nCurrent");
    memory.put("agents/one/AGENT.md", "---\nname: Older\n---\nOlder");
    memory.put("agents/one/agent.json", JSON.stringify({ name: "Oldest" }));
    memory.put("agents/one/servers.json", JSON.stringify([existingServer]));
    memory.put("chats/one/chat.json", JSON.stringify({ ...legacy, title: "Existing" }));
    memory.put("chats/one.json", JSON.stringify({ ...legacy, title: "Older" }));
    memory.put("chats/one/artifacts/keep.txt", "Keep");
    const saved = await snapshotFiles();
    let failed = false;
    memory.beforeWrite = async (path) => {
      if (path === "chats/index.json" && !failed) {
        failed = true;
        throw new Error("Index write failed");
      }
    };
    await expect(
      opfs.importFolderFromZip(
        "/",
        await zip({
          "agents/one/agent.json": JSON.stringify({ name: "Imported", servers: [] }),
          "chats/one.json": JSON.stringify(legacy),
        }),
      ),
    ).rejects.toThrow("Index write failed");
    expect(await snapshotFiles()).toEqual(saved);
  });

  it("leaves local legacy definitions untouched when their imported JSON is malformed", async () => {
    memory.put("agents/one/AGENTS.md", md);
    memory.put("agents/one/servers.json", JSON.stringify([existingServer]));
    const saved = await snapshotFiles();
    const result = await importAgentsFromZip(await zip({ "agents/one/agent.json": "{broken" }));
    expect(result.restoredFiles).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(await snapshotFiles()).toEqual(saved);
  });

  it.each(["settings", "agents"])(
    "%s import deduplicates identical bundled skills shared by agents and the global collection",
    async (route) => {
      const archive = await zip({
        "agents/one/AGENTS.md": md,
        "agents/two/AGENTS.md": md,
        "agents/one/skills/example/SKILL.md": skill,
        "agents/two/skills/example/SKILL.md": skill,
        "skills/example/SKILL.md": skill,
      });
      if (route === "settings") await opfs.importFolderFromZip("/", archive);
      else await importAgentsFromZip(archive);
      expect(await opfs.readText("skills/example/SKILL.md")).toBe(skill);
      expect(await opfs.readIndex("skills")).toHaveLength(1);
      expect(await opfs.readText("agents/one/skills/example/SKILL.md")).toBeUndefined();
    },
  );

  it.each(["settings", "agents"])(
    "%s import rejects conflicting bundled skills before changing storage",
    async (route) => {
      const archive = await zip({
        "agents/one/AGENTS.md": md,
        "agents/one/skills/example/SKILL.md": skill,
        "skills/example/SKILL.md": `${skill}\nDifferent`,
      });
      await expect(
        route === "settings" ? opfs.importFolderFromZip("/", archive) : importAgentsFromZip(archive),
      ).rejects.toThrow("Conflicting archive paths");
      expect(memory.files.size).toBe(0);
    },
  );

  it.each(["settings", "agents"])(
    "%s import validates relocated bundled skills before changing storage",
    async (route) => {
      const archive = await zip({
        "agents/one/AGENTS.md": md,
        "agents/one/skills/example/SKILL.md": "---\nname: wrong\ndescription: Wrong\n---\nBody",
      });
      await expect(
        route === "settings" ? opfs.importFolderFromZip("/", archive) : importAgentsFromZip(archive),
      ).rejects.toThrow("Invalid skill definition");
      expect(memory.files.size).toBe(0);
    },
  );

  it.each(["chats/one.json", "chats/one/chat.json"])(
    "skips both layouts when %s contains malformed JSON",
    async (brokenPath) => {
      memory.put("chats/one/chat.json", JSON.stringify({ ...legacy, title: "Existing" }));
      memory.put("chats/one.json", JSON.stringify({ ...legacy, title: "Older" }));
      memory.put("chats/one/artifacts/keep.txt", "Keep");
      const saved = await snapshotFiles();
      const result = await opfs.importFolderFromZip(
        "/",
        await zip({
          "chats/one.json": JSON.stringify(legacy),
          "chats/one/chat.json": JSON.stringify(legacy),
          "chats/one/artifacts/keep.txt": "Replace",
          [brokenPath]: "{broken",
          "chats/two/chat.json": JSON.stringify({ ...legacy, id: "two" }),
        }),
      );
      expect(result.skipped).toEqual([{ path: brokenPath, reason: expect.stringContaining("Invalid JSON") }]);
      const restored = await snapshotFiles();
      for (const [path, bytes] of saved) expect(restored.get(path)).toEqual(bytes);
      expect(await opfs.readJson("chats/two/chat.json")).toMatchObject({ id: "two" });
    },
  );
});
