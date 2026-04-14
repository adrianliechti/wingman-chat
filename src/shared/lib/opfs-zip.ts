/**
 * OPFS ZIP — Generic ZIP export/import and folder index rebuilding.
 *
 * Domain-specific bundling (agents + skills, legacy repositories) lives in
 * the respective feature modules (e.g. features/settings/lib/agentImportExport).
 */

import JSZip from "jszip";
import { getDirectory, getRoot, type IndexEntry, readJson, readText, writeBlob, writeJson } from "./opfs-core";

// ============================================================================
// Helpers
// ============================================================================

/** Recursively add a directory handle's contents to a JSZip folder. */
export async function addDirectoryToZip(handle: FileSystemDirectoryHandle, zipFolder: JSZip): Promise<void> {
  for await (const [name, entryHandle] of handle.entries()) {
    if (entryHandle.kind === "file") {
      const file = await (entryHandle as FileSystemFileHandle).getFile();
      zipFolder.file(name, await file.arrayBuffer());
    } else {
      const subFolder = zipFolder.folder(name);
      if (!subFolder) {
        throw new Error(`Failed to add folder to zip: ${name}`);
      }
      await addDirectoryToZip(entryHandle as FileSystemDirectoryHandle, subFolder);
    }
  }
}

// ============================================================================
// ZIP Export/Import
// ============================================================================

/**
 * Export a specific folder from OPFS as a ZIP blob.
 * Use empty string or '/' for root.
 */
export async function exportFolderAsZip(folderPath: string): Promise<Blob> {
  const zip = new JSZip();

  try {
    const isRoot = !folderPath || folderPath === "/";
    const folderHandle = isRoot ? await getRoot() : await getDirectory(folderPath);
    await addDirectoryToZip(folderHandle, zip);
  } catch {
    // Folder doesn't exist, return empty zip
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/**
 * Import data from a ZIP file into a specific folder in OPFS.
 * Merges with existing data (does not replace).
 * Rebuilds the folder index automatically after import.
 */
export async function importFolderFromZip(folderPath: string, zipBlob: Blob): Promise<void> {
  const zip = await JSZip.loadAsync(zipBlob);

  await getDirectory(folderPath, { create: true });

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    const fullPath = `${folderPath}/${relativePath}`;

    if (zipEntry.dir) {
      await getDirectory(fullPath.replace(/\/$/, ""), { create: true });
    } else {
      const content = await zipEntry.async("arraybuffer");
      await writeBlob(fullPath, new Blob([content]));
    }
  }

  await rebuildFolderIndex(folderPath);
}

/**
 * Export a folder as a ZIP and trigger a browser download.
 */
export async function downloadFolderAsZip(folderPath: string, filename: string): Promise<void> {
  const blob = await exportFolderAsZip(folderPath);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Folder Index Rebuild
// ============================================================================

/**
 * Rebuild the index for a folder-based collection by scanning its
 * subdirectories and probing for known metadata formats.
 *
 * Probe order per subfolder:
 *  1. AGENTS.md / AGENT.md  (agent collection)
 *  2. chat.json              (chat collection)
 *  3. agent.json / repository.json / metadata.json  (legacy formats)
 */
export async function rebuildFolderIndex(collection: string): Promise<void> {
  const entries: IndexEntry[] = [];

  try {
    const folderHandle = await getDirectory(collection);

    for await (const [name, entryHandle] of folderHandle.entries()) {
      if (name === "index.json") continue;

      if (entryHandle.kind === "directory") {
        const id = name;
        let title = name;
        let updated = new Date().toISOString();

        // Try AGENTS.md / AGENT.md
        try {
          const agentMd =
            (await readText(`${collection}/${id}/AGENTS.md`)) || (await readText(`${collection}/${id}/AGENT.md`));
          if (agentMd) {
            const nameMatch = agentMd.match(/^name:\s*(.+)$/m);
            if (nameMatch) title = nameMatch[1].trim();
            entries.push({ id, title, updated });
            continue;
          }
        } catch {
          /* not an agent folder */
        }

        // Try JSON metadata files
        const metadataFiles = [
          `${collection}/${id}/chat.json`,
          `${collection}/${id}/agent.json`,
          `${collection}/${id}/repository.json`,
          `${collection}/${id}/metadata.json`,
        ];

        for (const metaPath of metadataFiles) {
          try {
            const meta = await readJson<{
              title?: string;
              name?: string;
              updated?: string;
              updatedAt?: string;
            }>(metaPath);
            if (meta) {
              title = meta.title || meta.name || title;
              updated = meta.updated || meta.updatedAt || updated;
              break;
            }
          } catch {
            /* try next */
          }
        }

        entries.push({ id, title, updated });
      }
    }

    await writeJson(`${collection}/index.json`, entries);
  } catch {
    // Folder doesn't exist, nothing to rebuild
  }
}
