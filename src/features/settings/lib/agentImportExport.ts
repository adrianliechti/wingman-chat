import type JSZip from "jszip";
import type { Agent } from "@/features/agent/types/agent";
import { parseAgentMd, serializeAgentMd } from "@/features/agent/lib/agentMarkdown";
import { storeAgent, removeAgent } from "@/features/agent/lib/agentStorage";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { getDirectory, listDirectories, readText } from "@/shared/lib/opfs-core";
import { addDirectoryToZip, getZipFolder } from "@/shared/lib/opfs-zip";
import { readZipFiles, restoreFiles } from "@/shared/lib/opfs-restore";
import { flushPersistence, withPersistenceLock } from "@/shared/lib/persistence";
import { downloadBlob } from "@/shared/lib/utils";

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

export async function exportAgentsAsZip(): Promise<void> {
  await flushPersistence();
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  await withPersistenceLock("collection:agents", () =>
    withPersistenceLock("collection:skills", async () => {
      for (const id of await listDirectories("agents")) {
        const folder = getZipFolder(zip, `agents/${id}`);
        await addDirectoryToZip(await getDirectory(`agents/${id}`), folder);
        const md = await readAgentMd(id);
        if (md) await addSkillsToZip(parseAgentMd(md)?.skills ?? [], folder);
      }
    }),
  );
  await downloadBlob(
    await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    `wingman-agents-${new Date().toISOString().split("T")[0]}.zip`,
  );
}

export async function exportSingleAgentAsZip(
  id: string,
  { includeMemory = false }: { includeMemory?: boolean } = {},
): Promise<void> {
  await flushPersistence();
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  let name = "agent";
  await withPersistenceLock("collection:agents", () =>
    withPersistenceLock("collection:skills", async () => {
      await addDirectoryToZip(await getDirectory(`agents/${id}`), zip);
      if (!includeMemory) zip.remove("MEMORY.md");
      const md = await readAgentMd(id);
      const parsed = md ? parseAgentMd(md) : undefined;
      if (parsed) {
        name = parsed.name;
        await addSkillsToZip(parsed.skills, zip);
      }
    }),
  );
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  await downloadBlob(
    await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    `wingman-agent-${safeName}-${new Date().toISOString().split("T")[0]}.zip`,
  );
}

function importedAgent(value: unknown, id: string): Agent {
  if (!value || typeof value !== "object") throw new Error("Invalid agent record");
  const data = value as Partial<Agent>;
  for (const list of [data.skills, data.plugins, data.tools, data.servers, data.files]) {
    if (list !== undefined && !Array.isArray(list)) throw new Error("Invalid agent list in backup");
  }
  return {
    ...data,
    id,
    name: typeof data.name === "string" ? data.name : "Imported Agent",
    skills: data.skills ?? [],
    plugins: data.plugins ?? [],
    tools: data.tools ?? [],
    servers: data.servers ?? [],
    files: data.files?.map((file) => ({
      ...file,
      id: file.id || crypto.randomUUID(),
      uploadedAt: new Date(file.uploadedAt ?? Date.now()),
    })),
  };
}

/** Accept full backups, collection exports, and a single shareable agent. */
export async function importAgentsFromZip(file: Blob): Promise<void> {
  const files = await readZipFiles(file);
  const mapped = new Map<string, Blob>();
  const paths = [...files.keys()];
  const flat = paths.some((path) => /^(AGENTS?\.md|agent\.json)$/.test(path));
  const roots = flat
    ? [""]
    : [
        ...new Set(
          paths.flatMap((path) => {
            const match = path.match(
              /^((?:agents\/|repositories\/)?[^/]+)\/(AGENTS?\.md|agent\.json|repository\.json)$/,
            );
            return match ? [match[1]] : [];
          }),
        ),
      ];
  if (!roots.length) throw new Error("Unrecognized archive: expected an agent definition");
  for (const root of roots) {
    const prefix = root ? `${root}/` : "";
    const repository = files.has(`${prefix}repository.json`);
    const id = flat || repository ? crypto.randomUUID() : root.split("/").at(-1)!;
    for (const [path, blob] of files) {
      if (!path.startsWith(prefix)) continue;
      const relative = path.slice(prefix.length);
      if (relative.startsWith("skills/")) {
        mapped.set(relative, blob);
        continue;
      }
      if (relative === "index.json" || /^(agent|repository)\.json$/.test(relative)) continue;
      mapped.set(`agents/${id}/${relative === "AGENT.md" ? "AGENTS.md" : relative}`, blob);
    }
    if (!mapped.has(`agents/${id}/AGENTS.md`)) {
      const meta = files.get(`${prefix}${repository ? "repository" : "agent"}.json`)!;
      const agent = importedAgent(JSON.parse(await meta.text()), id);
      mapped.set(`agents/${id}/AGENTS.md`, new Blob([serializeAgentMd(agent)]));
      mapped.set(`agents/${id}/servers.json`, new Blob([JSON.stringify(agent.servers)]));
    }
  }
  // Full backups store skills beside agents; shareable exports bundle them.
  for (const [path, blob] of files) if (path.startsWith("skills/")) mapped.set(path, blob);
  if (files.has("agents/index.json"))
    mapped.set("agents/index.json", files.get("agents/index.json")!);
  await restoreFiles(mapped);
}

/** Compatibility lives at import time; current persistence has one write path. */
export async function importAgentsFromLegacyJson(
  jsonData: string,
): Promise<{ total: number; imported: number; failed: number }> {
  const data = JSON.parse(jsonData);
  const records = data.agents ?? data.repositories;
  if (!Array.isArray(records)) throw new Error("Expected an agents or repositories array");
  let imported = 0;
  for (const record of records) {
    const id = crypto.randomUUID();
    try {
      await storeAgent(importedAgent(record, id));
      imported++;
    } catch (error) {
      await removeAgent(id).catch((cleanupError) =>
        console.error("Import cleanup failed:", cleanupError),
      );
      console.error("Could not import agent:", error);
    }
  }
  return { total: records.length, imported, failed: records.length - imported };
}

export function triggerAgentImport(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,.json";
  input.multiple = false;

  input.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const isZip = file.name.toLowerCase().endsWith(".zip");

    if (isZip) {
      if (
        !(await confirm({
          title: "Import agents?",
          message: "Agents and skills from the ZIP will be merged with your existing ones.",
        }))
      )
        return;
      try {
        await importAgentsFromZip(file);
        window.location.reload();
      } catch (error) {
        console.error("Failed to import agents:", error);
        notify.error("Couldn't import agents", "Check the file and try again.");
      }
    } else {
      try {
        const jsonData = await file.text();
        const parsed = JSON.parse(jsonData);
        const count = (parsed.agents ?? parsed.repositories)?.length ?? 0;
        if (!count) {
          notify.error("Invalid import file", "No agents were found in this file.");
          return;
        }
        if (
          !(await confirm({
            title: "Import agents?",
            message: `${count} agent${count === 1 ? "" : "s"} will be added alongside your existing ones.`,
          }))
        )
          return;

        const result = await importAgentsFromLegacyJson(jsonData);
        if (result.failed) {
          notify.error(
            "Some agents could not be imported",
            `${result.imported} imported; ${result.failed} failed.`,
          );
          if (!result.imported) return;
        }
        notify.success(
          "Agents imported",
          `${result.imported} agent${result.imported === 1 ? "" : "s"} added. Reloading…`,
        );
        setTimeout(() => window.location.reload(), 1200);
      } catch (error) {
        console.error("Failed to import agents:", error);
        notify.error("Couldn't import agents", "Check the file format and try again.");
      }
    }
  };

  input.click();
}
