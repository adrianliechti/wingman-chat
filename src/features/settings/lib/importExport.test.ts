import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import * as opfs from "@/shared/lib/opfs";
import { loadAgent } from "@/features/agent/lib/agentStorage";
import { importChatsFromLegacyJson, importChatsFromZip } from "./chatImportExport";
import { importAgentsFromLegacyJson, importAgentsFromZip } from "./agentImportExport";
import { migrateChat } from "./v1Migration";

const memory = new MemoryOpfs();
const zip = async (files: Record<string, string>) => {
  const archive = new JSZip();
  for (const [path, text] of Object.entries(files)) archive.file(path, text);
  return new Blob([await archive.generateAsync({ type: "arraybuffer" })]);
};
const chat = { id: "one", created: "2026-01-01", updated: "2026-01-02", model: null, messages: [] };
const agentMd = "---\nname: Test\nskills: [example]\n---\nInstructions";
beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});

describe("flexible chat restore", () => {
  it.each(["one/chat.json", "chats/one/chat.json", "chat.json", "backup/chats/one/chat.json"])(
    "accepts %s",
    async (path) => {
      await importChatsFromZip(await zip({ [path]: JSON.stringify(chat) }));
      expect(await opfs.readJson("chats/one/chat.json")).toEqual(chat);
      expect((await opfs.readIndex("chats")).map((entry) => entry.id)).toEqual(["one"]);
    },
  );

  it("selects chats from a full backup and rejects unrelated collection indexes", async () => {
    await importChatsFromZip(await zip({ "chats/one/chat.json": JSON.stringify(chat), "agents/a/AGENTS.md": agentMd }));
    expect(await opfs.listDirectories("chats")).toEqual(["one"]);
    await expect(importChatsFromZip(await zip({ "index.json": "[]", "a/AGENTS.md": agentMd }))).rejects.toThrow(
      "expected a chats export",
    );
  });

  it("current JSON messages retain identities, phases, tool state, usage and references", async () => {
    const messages = [
      {
        id: "message",
        runId: "run",
        createdAt: "2026-01-01",
        role: "assistant",
        usage: { outputTokens: 4 },
        content: [
          { type: "text", text: "Working", phase: "commentary" },
          { type: "tool_call", id: "call", name: "tool", arguments: "{}", incomplete: true },
          {
            type: "tool_result",
            id: "call",
            name: "tool",
            arguments: "{}",
            meta: { view: "saved" },
            content: { structured: true },
            result: [{ type: "text", text: "Result" }],
          },
          { type: "artifact_ref", path: "/a.txt", revision: "r1" },
        ],
      },
    ];
    expect(migrateChat({ ...chat, messages }).messages).toEqual(messages);
    const result = await importChatsFromLegacyJson(
      JSON.stringify({ chats: [{ ...chat, customTitle: "Custom", customIndex: 4, messages }, null] }),
    );
    expect(result).toEqual({ total: 2, imported: 1, failed: 1 });
    const [entry] = await opfs.readIndex("chats");
    const loaded = await opfs.readJson<opfs.StoredChat>(`chats/${entry.id}/chat.json`);
    expect(loaded).toMatchObject({ customTitle: "Custom", customIndex: 4, messages });
  });

  it("converts older content without dropping separate tool calls from array messages", () => {
    const result = migrateChat({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", data: "Hello" }],
          toolCalls: [{ id: "call", name: "tool", arguments: "{}" }],
        },
        { role: "tool", content: "Result", error: "Old error" },
      ],
    });
    expect(result.messages[0].content).toEqual([
      { type: "text", text: "Hello" },
      { type: "tool_call", id: "call", name: "tool", arguments: "{}" },
    ]);
    expect(result.messages[1]).toMatchObject({ role: "user", error: { code: "legacy_error", message: "Old error" } });
  });
});

describe("agent restore", () => {
  it.each(["AGENTS.md", "AGENT.md", "one/AGENTS.md", "agents/one/AGENTS.md"])(
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

  it("uses current persistence for legacy JSON, preserving models, tools, servers and files", async () => {
    const result = await importAgentsFromLegacyJson(
      JSON.stringify({
        repositories: [
          {
            name: "Old",
            model: "model",
            tools: ["internet"],
            skills: [],
            servers: [{ id: "server", name: "Server", url: "https://example.test", enabled: true }],
            files: [
              {
                id: "file",
                name: "x.txt",
                uploadedAt: "2020-01-01",
                text: "",
                status: "completed",
                progress: 100,
                segments: [{ text: "chunk", vector: [0.5, 1] }],
              },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual({ total: 1, imported: 1, failed: 0 });
    const [entry] = await opfs.readIndex("agents");
    expect(await loadAgent(entry.id)).toMatchObject({
      name: "Old",
      model: "model",
      tools: ["internet"],
      servers: [{ id: "server" }],
      files: [{ id: "file", text: "", segments: [{ text: "chunk", vector: [0.5, 1] }] }],
    });
  });
});
