import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import {
  exportAgentsAsZip,
  exportSingleAgentAsZip,
  importAgentsFromZip,
} from "@/features/settings/lib/agentImportExport";
import { MemoryManager } from "./memoryManager";
import { emptyMemoryState } from "./memoryState";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/utils", async (original) => ({ ...(await original<object>()), downloadBlob: download }));
const disk = new MemoryOpfs();
beforeEach(() => {
  disk.reset();
  download.mockReset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => disk.root } });
  disk.put("agents/agent/AGENTS.md", "---\nname: Agent\nmemory: true\n---\n");
  disk.put("agents/agent/memory/preferences.md", "---\ntype: Preference\n---\nPrivate preference.");
  disk.put("agents/agent/MEMORY.md", "Legacy private memory.");
  disk.put("agents/agent/memory-state.json", JSON.stringify(emptyMemoryState()));
});
async function exported() {
  return JSZip.loadAsync(await (download.mock.calls.at(-1)![0] as Blob).arrayBuffer());
}

describe("memory exchange", () => {
  it("omits all memory and internal queue state from the default shareable agent", async () => {
    await exportSingleAgentAsZip("agent");
    expect(Object.keys((await exported()).files)).not.toEqual(
      expect.arrayContaining(["MEMORY.md", "memory/preferences.md", "memory-state.json"]),
    );
    expect((await exported()).file("AGENTS.md")).not.toBeNull();
    expect(Object.keys((await exported()).files).some((name) => name.startsWith("memory"))).toBe(false);
  });

  it("includes notes only on request and reserves runtime state for backups", async () => {
    await exportSingleAgentAsZip("agent", { includeMemory: true });
    const shared = await exported();
    expect(await shared.file("memory/preferences.md")?.async("string")).toContain("Private preference");
    expect(shared.file("memory-state.json")).toBeNull();
    await exportAgentsAsZip();
    expect((await exported()).file("agents/agent/memory-state.json")).not.toBeNull();
  });

  it("normalizes imported notes and derives indexes instead of trusting archived listings", async () => {
    const zip = new JSZip();
    zip.file("AGENTS.md", "---\nname: Imported\nmemory: true\n---\n");
    zip.file(
      "memory/projects/test.md",
      "---\ntype: Decision\ntitle: Test decision\ncustom: {nested: true}\n---\nKeep this decision.",
    );
    zip.file("memory/index.md", "A stale fake listing.");
    await importAgentsFromZip(new Blob([await zip.generateAsync({ type: "arraybuffer" })]));
    const definition = [...disk.files.keys()].find((path) => path.endsWith("/AGENTS.md") && !path.includes("/agent/"))!;
    const id = definition.split("/")[1];
    const snapshot = await new MemoryManager(id).snapshot();
    expect(snapshot.files.get("projects/test.md")).toContain("nested: true");
    const index = await disk.files.get(`agents/${id}/memory/index.md`)!.text();
    expect(index).toContain("projects/test.md");
    expect(index).not.toContain("fake listing");
  });
});
