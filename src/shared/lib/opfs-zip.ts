/**
 * OPFS ZIP — Generic ZIP export/import and folder index rebuilding.
 *
 * Domain-specific bundling (agents + skills, legacy repositories) lives in
 * the respective feature modules (e.g. features/settings/lib/agentImportExport).
 */

import type JSZip from "jszip";
import { withArtifactWorkspaceLock } from "@/features/artifacts/lib/workspaceCoordinator";
import { getDirectory, getRoot } from "./opfs-core";
import { downloadBlob } from "./utils";
import { flushForBackup, withPersistenceLock } from "./persistence";
import { STORAGE_COLLECTIONS } from "./opfs-index";
import { readZipFiles, restoreFiles } from "./opfs-restore";
export { rebuildFolderIndex } from "./opfs-index";

// ============================================================================
// Helpers
// ============================================================================

/** Recursively add a directory handle's contents to a JSZip folder. */
export async function addDirectoryToZip(
  handle: FileSystemDirectoryHandle,
  zipFolder: JSZip,
  path = "",
): Promise<void> {
  for await (const [name, entryHandle] of handle.entries()) {
    if (entryHandle.kind === "file") {
      const file = await (entryHandle as FileSystemFileHandle).getFile();
      zipFolder.file(name, await file.arrayBuffer());
    } else {
      const subFolder = zipFolder.folder(name);
      if (!subFolder) {
        throw new Error(`Failed to add folder to zip: ${name}`);
      }
      const childPath = path ? `${path}/${name}` : name;
      const copy = () =>
        addDirectoryToZip(entryHandle as FileSystemDirectoryHandle, subFolder, childPath);
      if (path === "chats") await withArtifactWorkspaceLock(name, copy);
      else await copy();
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
  return path.split("/").includes("__MACOSX") || name === ".DS_Store" || name === "Thumbs.db";
}

// ============================================================================
// ZIP Export/Import
// ============================================================================

/** Reports ZIP generation progress as a fraction in the range [0, 1]. */
export type ZipProgressHandler = (fraction: number) => void;

/**
 * Export a specific folder from OPFS as a ZIP blob.
 * Use empty string or '/' for root.
 */
export async function exportFolderAsZip(
  folderPath: string,
  onProgress?: ZipProgressHandler,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  await flushForBackup();
  const collection = folderPath.split("/").filter(Boolean)[0];
  // Same lock order as restoreFiles so an export and a restore in two tabs
  // cannot wait on each other forever.
  const keys = collection ? [collection] : [...STORAGE_COLLECTIONS, "profile"].sort();
  const snapshot = async () => {
    const isRoot = !folderPath || folderPath === "/";
    let folderHandle: FileSystemDirectoryHandle;
    try {
      folderHandle = isRoot ? await getRoot() : await getDirectory(folderPath);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return;
      throw error;
    }
    // Read failures must fail the backup, never produce a silent partial ZIP.
    await addDirectoryToZip(folderHandle, zip, folderPath.split("/").filter(Boolean).join("/"));
  };
  const locked = (index: number): Promise<void> =>
    index === keys.length
      ? snapshot()
      : withPersistenceLock(`collection:${keys[index]}`, () => locked(index + 1));
  await locked(0);

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" }, (metadata) =>
    onProgress?.(metadata.percent / 100),
  );
}

/**
 * Import data from a ZIP file into a specific folder in OPFS.
 * Merges with existing data (does not replace).
 * Rebuilds the folder index automatically after import.
 */
export async function importFolderFromZip(
  folderPath: string,
  zipBlob: Blob,
  onProgress?: ZipProgressHandler,
): Promise<void> {
  const files = await readZipFiles(zipBlob, (fraction) => onProgress?.(fraction * 0.5));
  const folder = folderPath.split("/").filter(Boolean).join("/");
  const prefixed = [...files.keys()].some((path) => path.startsWith(`${folder}/`));
  const mapped = new Map<string, Blob>();
  for (const [path, blob] of files) {
    if (folder && prefixed && !path.startsWith(`${folder}/`)) continue;
    mapped.set(folder && !prefixed ? `${folder}/${path}` : path, blob);
  }
  await restoreFiles(mapped, (fraction) => onProgress?.(0.5 + fraction * 0.5));
}

/**
 * Export a folder as a ZIP and trigger a browser download.
 */
export async function downloadFolderAsZip(
  folderPath: string,
  filename: string,
  onProgress?: ZipProgressHandler,
): Promise<void> {
  const blob = await exportFolderAsZip(folderPath, onProgress);
  await downloadBlob(blob, filename);
}

/** Export selected top-level OPFS folders together in a single ZIP. */
export async function downloadFoldersAsZip(
  folderPaths: string[],
  filename: string,
  onProgress?: ZipProgressHandler,
): Promise<void> {
  const paths = [
    ...new Set(folderPaths.map((path) => path.replace(/^\/+|\/+$/g, "")).filter(Boolean)),
  ].sort();
  if (!paths.length) throw new Error("Select at least one folder to export.");
  for (const path of paths) {
    if (path.includes("/")) throw new Error(`Only top-level paths can be exported: ${path}`);
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  await flushForBackup();

  const snapshot = async () => {
    const root = await getRoot();
    for (const path of paths) {
      // A root entry such as profile.json is a file: asking for it as a
      // directory throws TypeMismatchError, and it must land in the archive as
      // a file entry, not as an empty folder of the same name.
      let handle: FileSystemDirectoryHandle | FileSystemFileHandle;
      try {
        handle = await root.getDirectoryHandle(path);
      } catch (error) {
        if (!(error instanceof DOMException)) throw error;
        if (error.name === "NotFoundError") continue;
        if (error.name !== "TypeMismatchError") throw error;
        handle = await root.getFileHandle(path);
      }
      if (handle.kind === "file") {
        zip.file(path, await (await handle.getFile()).arrayBuffer());
      } else {
        await addDirectoryToZip(handle, getZipFolder(zip, path), path);
      }
    }
  };
  const lock = (index: number): Promise<void> =>
    index === paths.length
      ? snapshot()
      : withPersistenceLock(
          `collection:${paths[index] === "profile.json" ? "profile" : paths[index]}`,
          () => lock(index + 1),
        );
  await lock(0);

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }, (metadata) =>
    onProgress?.(metadata.percent / 100),
  );
  await downloadBlob(blob, filename);
}
