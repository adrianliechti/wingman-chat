import JSZip from "jszip";
import { getDirectory, writeJson, writeText, writeBlob, readText, readIndex } from "@/shared/lib/opfs-core";
import { addDirectoryToZip, rebuildFolderIndex } from "@/shared/lib/opfs-zip";

// ============================================================================
// Export
// ============================================================================

/**
 * Export all agents with their referenced skills bundled into a single ZIP.
 * Skills are nested inside each agent folder: agents/{uuid}/skills/{name}/…
 * This makes each agent folder self-contained for sharing.
 */
export async function exportAgentsAsZip(): Promise<void> {
  const zip = new JSZip();

  try {
    const agentIndex = await readIndex("agents");
    const agentsZip = zip.folder("agents")!;

    for (const entry of agentIndex) {
      const agentFolder = agentsZip.folder(entry.id)!;

      // Add agent's own files (AGENTS.md, servers.json, files/, etc.)
      try {
        const agentHandle = await getDirectory(`agents/${entry.id}`);
        await addDirectoryToZip(agentHandle, agentFolder);
      } catch {
        continue;
      }

      // Parse skill names from AGENTS.md and bundle referenced skills
      const md = (await readText(`agents/${entry.id}/AGENTS.md`)) || (await readText(`agents/${entry.id}/AGENT.md`));
      if (!md) continue;

      const skillsMatch = md.match(/^skills:\s*(.+)$/m);
      if (!skillsMatch) continue;

      let skillNames: string[];
      const raw = skillsMatch[1].trim();
      const bracketMatch = raw.match(/^\[(.*)\]$/);
      if (bracketMatch) {
        skillNames = bracketMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else {
        skillNames = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const skillsFolder = agentFolder.folder("skills")!;

      for (const skillName of skillNames) {
        try {
          const skillHandle = await getDirectory(`skills/${skillName}`);
          const skillZipFolder = skillsFolder.folder(skillName)!;
          await addDirectoryToZip(skillHandle, skillZipFolder);
        } catch {
          /* skill folder missing */
        }
      }
    }
  } catch {
    /* no agents */
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wingman-agents-${new Date().toISOString().split("T")[0]}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export a single agent (with referenced skills) as a ZIP.
 */
export async function exportSingleAgentAsZip(
  agentId: string,
  { includeMemory = false }: { includeMemory?: boolean } = {},
): Promise<void> {
  const zip = new JSZip();

  // Add agent's own files (AGENTS.md, servers.json, files/, etc.) at the root
  const agentHandle = await getDirectory(`agents/${agentId}`);
  await addDirectoryToZip(agentHandle, zip);

  // Strip MEMORY.md unless explicitly requested
  if (!includeMemory) {
    zip.remove("MEMORY.md");
  }

  // Parse skill names from AGENTS.md and bundle referenced skills
  const md = (await readText(`agents/${agentId}/AGENTS.md`)) || (await readText(`agents/${agentId}/AGENT.md`));

  if (md) {
    const skillsMatch = md.match(/^skills:\s*(.+)$/m);
    if (skillsMatch) {
      let skillNames: string[];
      const raw = skillsMatch[1].trim();
      const bracketMatch = raw.match(/^\[(.*)\]$/);
      if (bracketMatch) {
        skillNames = bracketMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else {
        skillNames = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const skillsFolder = zip.folder("skills")!;
      for (const skillName of skillNames) {
        try {
          const skillHandle = await getDirectory(`skills/${skillName}`);
          const skillZipFolder = skillsFolder.folder(skillName)!;
          await addDirectoryToZip(skillHandle, skillZipFolder);
        } catch {
          /* skill folder missing */
        }
      }
    }
  }

  // Derive a filename-safe agent name from AGENTS.md frontmatter
  let agentName = "agent";
  if (md) {
    const nameMatch = md.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      agentName = nameMatch[1]
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .toLowerCase();
    }
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wingman-agent-${agentName}-${new Date().toISOString().split("T")[0]}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Import — ZIP
// ============================================================================

/**
 * Import agents (with bundled skills) from a ZIP file.
 * Supports three formats:
 *  1. New: agents/{uuid}/AGENTS.md with optional agents/{uuid}/skills/{name}/…
 *  2. Flat: AGENTS.md at the root (no uuid folder) — a new UUID is generated.
 *  3. Legacy: {uuid}/repository.json with optional {uuid}/files/…
 *
 * Agent data goes to /agents/{uuid}/, skills are upserted to /skills/{name}/.
 * Merges with existing data and rebuilds indices.
 */
export async function importAgentsFromZip(file: Blob): Promise<void> {
  const zip = await JSZip.loadAsync(file);

  // Detect format
  const paths = Object.keys(zip.files);
  const isNewFormat = paths.some((p) => p.startsWith("agents/"));
  const isFlatFormat = !isNewFormat && paths.some((p) => p === "AGENTS.md" || p === "AGENT.md");
  const isLegacyRepo = !isNewFormat && !isFlatFormat && paths.some((p) => /^[^/]+\/repository\.json$/.test(p));

  if (isFlatFormat) {
    await importFlatAgentFromZip(zip);
    return;
  }

  if (isLegacyRepo) {
    await importLegacyRepositoriesFromZip(zip);
    return;
  }

  let hasAgents = false;
  let hasSkills = false;

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (!relativePath.startsWith("agents/")) continue;

    const afterAgents = relativePath.slice("agents/".length);

    // skills entry: {uuid}/skills/{name}/…
    const skillsMatch = afterAgents.match(/^[^/]+\/skills\/(.+)$/);
    if (skillsMatch) {
      const targetPath = `skills/${skillsMatch[1]}`;
      hasSkills = true;

      if (zipEntry.dir) {
        await getDirectory(targetPath.replace(/\/$/, ""), { create: true });
      } else {
        const content = await zipEntry.async("arraybuffer");
        await writeBlob(targetPath, new Blob([content]));
      }
    } else {
      const targetPath = `agents/${afterAgents}`;
      hasAgents = true;

      if (zipEntry.dir) {
        await getDirectory(targetPath.replace(/\/$/, ""), { create: true });
      } else {
        const content = await zipEntry.async("arraybuffer");
        await writeBlob(targetPath, new Blob([content]));
      }
    }
  }

  if (hasAgents) await rebuildFolderIndex("agents");
  if (hasSkills) await rebuildFolderIndex("skills");
}

// ============================================================================
// Import — Legacy JSON ({ repositories: [...] })
// ============================================================================

/**
 * Import agents from a legacy JSON export (`{ repositories: [...] }`).
 * Each repository is converted into an agent folder with AGENTS.md,
 * files, segments, and embeddings.
 *
 * @returns The number of successfully imported agents and failures.
 */
export async function importAgentsFromLegacyJson(
  jsonData: string,
): Promise<{ total: number; imported: number; failed: number }> {
  const importData = JSON.parse(jsonData);

  if (!importData.repositories || !Array.isArray(importData.repositories)) {
    throw new Error("Invalid import file: Expected repositories array not found.");
  }

  const total = importData.repositories.length;
  let imported = 0;

  for (const repoData of importData.repositories) {
    try {
      const agentId = crypto.randomUUID();
      const name = repoData.name || "Imported Repository";
      const instructions = repoData.instructions;

      // Generate AGENTS.md
      const mdLines: string[] = ["---"];
      mdLines.push(`name: ${name}`);
      mdLines.push("---");
      if (instructions) {
        mdLines.push("");
        mdLines.push(instructions);
      }
      await writeText(`agents/${agentId}/AGENTS.md`, mdLines.join("\n"));

      // Store files if present (old JSON format embeds text/vectors inline)
      if (repoData.files && Array.isArray(repoData.files)) {
        for (const fileData of repoData.files) {
          const fileId = fileData.id || crypto.randomUUID();
          const filePath = `agents/${agentId}/files/${fileId}`;

          const meta = {
            id: fileId,
            name: fileData.name || "Unknown File",
            status: fileData.status || "completed",
            progress: typeof fileData.progress === "number" ? fileData.progress : 100,
            error: fileData.error,
            uploadedAt: fileData.uploadedAt || new Date().toISOString(),
          };

          await writeJson(`${filePath}/metadata.json`, meta);

          if (fileData.text) {
            await writeText(`${filePath}/content.txt`, fileData.text);
          }

          if (fileData.segments && fileData.segments.length > 0) {
            const segmentTexts = fileData.segments.map((s: { text: string }) => s.text);
            await writeJson(`${filePath}/segments.json`, segmentTexts);

            const vectorDim = fileData.segments[0].vector.length;
            const totalFloats = 1 + fileData.segments.length * vectorDim;
            const buffer = new Float32Array(totalFloats);
            buffer[0] = vectorDim;
            let offset = 1;
            for (const segment of fileData.segments) {
              buffer.set(segment.vector, offset);
              offset += vectorDim;
            }
            const blob = new Blob([buffer.buffer], { type: "application/octet-stream" });
            await writeBlob(`${filePath}/embeddings.bin`, blob);
          }
        }
      }

      imported++;
    } catch (error) {
      console.error("Failed to import repository as agent:", repoData, error);
    }
  }

  if (imported > 0) {
    await rebuildFolderIndex("agents");
  }

  return { total, imported, failed: total - imported };
}

// ============================================================================
// Flat Agent ZIP Import (private)
// ============================================================================

/**
 * Import a single agent from a flat ZIP where AGENTS.md is at the root.
 * A new UUID is generated for the agent.
 * Skills nested under skills/{name}/ are upserted to /skills/{name}/.
 */
async function importFlatAgentFromZip(zip: JSZip): Promise<void> {
  const newId = crypto.randomUUID();
  let hasSkills = false;

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    // skills/{name}/… → upsert to global skills store
    if (relativePath.startsWith("skills/")) {
      const targetPath = relativePath;
      hasSkills = true;
      if (zipEntry.dir) {
        await getDirectory(targetPath.replace(/\/$/, ""), { create: true });
      } else {
        const content = await zipEntry.async("arraybuffer");
        await writeBlob(targetPath, new Blob([content]));
      }
      continue;
    }

    // Everything else (AGENTS.md, servers.json, MEMORY.md, files/…)
    // goes under agents/{newId}/
    if (zipEntry.dir) {
      await getDirectory(`agents/${newId}/${relativePath}`.replace(/\/$/, ""), { create: true });
    } else {
      const content = await zipEntry.async("arraybuffer");
      await writeBlob(`agents/${newId}/${relativePath}`, new Blob([content]));
    }
  }

  await rebuildFolderIndex("agents");
  if (hasSkills) await rebuildFolderIndex("skills");
}

// ============================================================================
// Legacy Repository ZIP Import (private)
// ============================================================================

/**
 * Import legacy repository ZIP format and convert to agents.
 * Legacy ZIPs have: {uuid}/repository.json, {uuid}/files/{fileId}/…
 * Each repository is converted to an agent with AGENTS.md.
 */
async function importLegacyRepositoriesFromZip(zip: JSZip): Promise<void> {
  const repoIds = new Set<string>();
  for (const path of Object.keys(zip.files)) {
    const match = path.match(/^([^/]+)\/repository\.json$/);
    if (match) repoIds.add(match[1]);
  }

  if (repoIds.size === 0) return;

  const idMap = new Map<string, string>();
  for (const oldId of repoIds) {
    idMap.set(oldId, crypto.randomUUID());
  }

  for (const [oldId, newId] of idMap) {
    const repoEntry = zip.file(`${oldId}/repository.json`);
    if (!repoEntry) continue;

    const repoJson = JSON.parse(await repoEntry.async("text")) as {
      id: string;
      name: string;
      embedder?: string;
      instructions?: string;
      createdAt?: string;
      updatedAt?: string;
    };

    const mdLines: string[] = ["---"];
    mdLines.push(`name: ${repoJson.name || "Imported Repository"}`);
    mdLines.push("---");
    if (repoJson.instructions) {
      mdLines.push("");
      mdLines.push(repoJson.instructions);
    }
    await writeText(`agents/${newId}/AGENTS.md`, mdLines.join("\n"));

    for (const [path, zipEntry] of Object.entries(zip.files)) {
      if (!path.startsWith(`${oldId}/files/`)) continue;
      const relPath = path.slice(`${oldId}/`.length);
      const targetPath = `agents/${newId}/${relPath}`;

      if (zipEntry.dir) {
        await getDirectory(targetPath.replace(/\/$/, ""), { create: true });
      } else {
        const content = await zipEntry.async("arraybuffer");
        await writeBlob(targetPath, new Blob([content]));
      }
    }
  }

  await rebuildFolderIndex("agents");
}
