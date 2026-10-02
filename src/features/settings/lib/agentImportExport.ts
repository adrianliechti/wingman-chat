import type JSZip from "jszip";
import { parseAgentMd, serializeAgentMd } from "@/features/agent/lib/agentMarkdown";
import { loadAgent } from "@/features/agent/lib/agentStorage";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { getDirectory, readText } from "@/shared/lib/opfs-core";
import { addDirectoryToZip, getZipFolder } from "@/shared/lib/opfs-zip";
import { readZipFiles, restoreFiles, type RestoreResult } from "@/shared/lib/opfs-restore";
import { flushForBackup, withPersistenceLock } from "@/shared/lib/persistence";
import { downloadZip } from "@/shared/lib/zipStreams";
import { finishRestore } from "./restoreReport";

async function readAgentMd(id: string): Promise<string | undefined> {
  return (await readText(`agents/${id}/AGENTS.md`)) ?? readText(`agents/${id}/AGENT.md`);
}

async function addSkillsToZip(names: string[], zip: JSZip): Promise<void> {
  for (const name of names) {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await getDirectory(`skills/${name}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") continue;
      throw error;
    }
    await addDirectoryToZip(handle, getZipFolder(zip, `skills/${name}`));
  }
}

export async function exportSingleAgentAsZip(
  id: string,
  { includeMemory = false, name = "agent" }: { includeMemory?: boolean; name?: string } = {},
): Promise<void> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  await downloadZip(`wingman-agent-${safeName}-${new Date().toISOString().split("T")[0]}.zip`, async () => {
    await flushForBackup();
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    await withPersistenceLock("collection:agents", () =>
      withPersistenceLock("collection:skills", async () => {
        await addDirectoryToZip(await getDirectory(`agents/${id}`), zip);
        // The runtime queue is never part of a shareable agent.
        zip.remove("memory-state.json");
        if (!includeMemory) {
          zip.remove("MEMORY.md");
          zip.remove("memory");
        }
        let md = await readAgentMd(id);
        if (!md) {
          const agent = await loadAgent(id);
          if (!agent) throw new Error("Agent not found");
          md = serializeAgentMd(agent);
          zip.file("servers.json", JSON.stringify(agent.servers));
        }
        // Export saved agents in the current format without rewriting local data.
        zip.remove("AGENT.md");
        zip.remove("agent.json");
        zip.file("AGENTS.md", md);
        const parsed = parseAgentMd(md);
        if (parsed) {
          await addSkillsToZip(parsed.skills, zip);
        }
      }),
    );
    return zip;
  });
}

/** Accept full backups, collection exports, and a single shareable agent. */
export async function importAgentsFromZip(file: Blob): Promise<RestoreResult> {
  const files = await readZipFiles(file);
  const mapped = new Map<string, Blob>();
  const paths = [...files.keys()];
  const flat = files.has("AGENTS.md");
  const roots = flat
    ? [""]
    : [
        ...new Set(
          paths.flatMap((path) => {
            const match = path.match(/^((?:agents\/)?[^/]+)\/AGENTS\.md$/);
            return match ? [match[1]] : [];
          }),
        ),
      ];
  if (!roots.length) throw new Error("Unrecognized archive: expected an AGENTS.md definition");
  for (const root of roots) {
    const prefix = root ? `${root}/` : "";
    const id = flat ? crypto.randomUUID() : root.split("/").at(-1)!;
    for (const [path, blob] of files) {
      if (!path.startsWith(prefix)) continue;
      const relative = path.slice(prefix.length);
      if (flat && relative === "memory-state.json") continue;
      if (relative.startsWith("skills/")) {
        mapped.set(relative, blob);
        continue;
      }
      if (relative === "index.json") continue;
      mapped.set(`agents/${id}/${relative}`, blob);
    }
  }
  // Full backups store skills beside agents; shareable exports bundle them.
  for (const [path, blob] of files) if (path.startsWith("skills/")) mapped.set(path, blob);
  if (files.has("agents/index.json")) mapped.set("agents/index.json", files.get("agents/index.json")!);
  return restoreFiles(mapped);
}

export function triggerAgentImport(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";
  input.multiple = false;

  input.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    if (
      !(await confirm({
        title: "Import agents?",
        message: "Agents and skills from the ZIP will be merged with your existing ones.",
      }))
    )
      return;
    try {
      await finishRestore(await importAgentsFromZip(file));
    } catch (error) {
      console.error("Failed to import agents:", error);
      notify.error("Couldn't import agents", "Check the file and try again.");
    }
  };

  input.click();
}
