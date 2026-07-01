/**
 * OPFS ZIP — Generic ZIP export/import and folder index rebuilding.
 *
 * Domain-specific bundling (agents + skills, legacy repositories) lives in
 * the respective feature modules (e.g. features/settings/lib/agentImportExport).
 */

import type JSZip from "jszip";
import { getDirectory, getRoot, type IndexEntry, readJson, readText, writeBlob, writeJson } from "./opfs-core";
import { downloadBlob } from "./utils";

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

/** Create a named subfolder in a JSZip archive, throwing on failure. */
export function getZipFolder(parent: JSZip, name: string): JSZip {
  const folder = parent.folder(name);
  if (!folder) {
    throw new Error(`Failed to create zip folder: ${name}`);
  }
  return folder;
}

/**
 * OS metadata entries that zip tools sneak into archives (macOS resource
 * forks, Finder/Explorer droppings). Imported as-is they become junk folders
 * that index rebuilds then surface as phantom items.
 */
export function isJunkZipEntry(path: string): boolean {
  const name = path.replace(/\/$/, "").split("/").pop();
  return path.startsWith("__MACOSX/") || name === ".DS_Store" || name === "Thumbs.db";
}

/** Extract a single ZIP entry (directory or file) to an OPFS path. */
export async function extractZipEntry(entry: JSZip.JSZipObject, targetPath: string): Promise<void> {
  if (entry.dir) {
    await getDirectory(targetPath.replace(/\/$/, ""), { create: true });
  } else {
    const content = await entry.async("arraybuffer");
    await writeBlob(targetPath, new Blob([content]));
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
  const JSZip = (await import("jszip")).default;
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
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(zipBlob);

  await getDirectory(folderPath, { create: true });

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (isJunkZipEntry(relativePath)) continue;
    await extractZipEntry(zipEntry, `${folderPath}/${relativePath}`);
  }

  await rebuildFolderIndex(folderPath);
}

/**
 * Export a folder as a ZIP and trigger a browser download.
 */
export async function downloadFolderAsZip(folderPath: string, filename: string): Promise<void> {
  const blob = await exportFolderAsZip(folderPath);
  downloadBlob(blob, filename);
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
 *  2. chat.json / notebook.json  (chat & notebook collections)
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
          `${collection}/${id}/notebook.json`,
          `${collection}/${id}/agent.json`,
          `${collection}/${id}/repository.json`,
          `${collection}/${id}/metadata.json`,
        ];

        let customTitle: string | undefined;
        for (const metaPath of metadataFiles) {
          try {
            const meta = await readJson<{
              title?: string;
              name?: string;
              customTitle?: string;
              updated?: string;
              updatedAt?: string;
            }>(metaPath);
            if (meta) {
              title = meta.title || meta.name || title;
              customTitle = meta.customTitle;
              updated = meta.updated || meta.updatedAt || updated;
              break;
            }
          } catch {
            /* try next */
          }
        }

        entries.push({ id, title, ...(customTitle && { customTitle }), updated });
      }
    }

    await writeJson(`${collection}/index.json`, entries);
  } catch {
    // Folder doesn't exist, nothing to rebuild
  }
}
