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

  it.each(["AGENT.md", "agent.json", "agents/one/agent.json", "repositories/one/repository.json"])(
    "rejects legacy %s archives before writing",
    async (path) => {
      await expect(importAgentsFromZip(await zip({ [path]: path.endsWith(".md") ? agentMd : "{}" }))).rejects.toThrow(
        "expected an AGENTS.md definition",
      );
      expect(memory.files.size).toBe(0);
    },
  );

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
