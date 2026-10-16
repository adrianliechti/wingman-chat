/**
 * OPFS ZIP — Generic ZIP export/import and folder index rebuilding.
 *
 * Domain-specific bundling (agents + skills) lives in
 * the respective feature modules (e.g. features/settings/lib/agentImportExport).
 */

import type JSZip from "jszip";
import { withArtifactWorkspaceLock } from "@/features/artifacts/lib/workspaceCoordinator";
import { parseSkillFileForImport } from "@/features/skills/lib/skillParser";
import { getDirectory, getRoot } from "./opfs-core";
import { downloadZip, generateZipBlob } from "./zipStreams";
import { flushForBackup, withPersistenceLock } from "./persistence";
import { STORAGE_COLLECTIONS } from "./opfs-index";
import { readZipFiles, restoreFiles, type RestoreResult } from "./opfs-restore";
export { rebuildFolderIndex } from "./opfs-index";

// ============================================================================
// Helpers
// ============================================================================

const SNAPSHOT_READ_ATTEMPTS = 3;
const SNAPSHOT_RETRY_DELAY_MS = 50;

/**
 * Retry files invalidated by writers outside the snapshot locks. Deleted files
 * are omitted with a warning; other read failures abort the backup.
 */
async function readFileForZip(
  directory: FileSystemDirectoryHandle,
  entry: FileSystemFileHandle,
  path: string,
): Promise<ArrayBuffer | undefined> {
  for (let attempt = 1; ; attempt++) {
    try {
      // The listed handle serves the common case; a retry asks for a fresh one
      // in case the entry was replaced rather than rewritten in place.
      const handle = attempt === 1 ? entry : await directory.getFileHandle(entry.name);
      return await (await handle.getFile()).arrayBuffer();
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      if (error.name === "NotFoundError") {
        console.warn(`Skipped a file that was deleted while the backup was running: ${path}`);
        return undefined;
      }
      if (error.name !== "NotReadableError" || attempt === SNAPSHOT_READ_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_RETRY_DELAY_MS));
    }
  }
}

/** Recursively add a directory handle's contents to a JSZip folder. */
export async function addDirectoryToZip(handle: FileSystemDirectoryHandle, zipFolder: JSZip, path = ""): Promise<void> {
  for await (const [name, entryHandle] of handle.entries()) {
    const childPath = path ? `${path}/${name}` : name;
    if (entryHandle.kind === "file") {
      const bytes = await readFileForZip(handle, entryHandle as FileSystemFileHandle, childPath);
      if (bytes !== undefined) zipFolder.file(name, bytes);
    } else {
      const subFolder = zipFolder.folder(name);
      if (!subFolder) {
        throw new Error(`Failed to add folder to zip: ${name}`);
      }
      // Listing a folder that no longer exists is the folder equivalent of a
      // deleted file: the records it held are gone, not unreadable.
      const copy = async () => {
        try {
          await addDirectoryToZip(entryHandle as FileSystemDirectoryHandle, subFolder, childPath);
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
          console.warn(`Skipped a folder that was deleted while the backup was running: ${childPath}`);
        }
      };
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
 * Snapshot a specific OPFS folder for ZIP generation.
 * Use empty string or '/' for root.
 */
async function createFolderZip(folderPath: string): Promise<JSZip> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  await flushForBackup();
  const collection = folderPath.split("/").filter(Boolean)[0];
  // Same lock order as restoreFiles so an export and a restore in two tabs
  // cannot wait on each other forever.
  const keys = collection ? [collection] : [...STORAGE_COLLECTIONS, "plugins", "profile"].sort();
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
    index === keys.length ? snapshot() : withPersistenceLock(`collection:${keys[index]}`, () => locked(index + 1));
  await locked(0);

  return zip;
}

export async function exportFolderAsZip(folderPath: string, onProgress?: ZipProgressHandler): Promise<Blob> {
  return generateZipBlob(await createFolderZip(folderPath), onProgress);
}

type InferredRecord = { collection: "chats" | "agents" | "skills"; id?: string };
/** Definitions that identify records exported without their collection folder. */
const RECORD_MARKERS = new Map<string, InferredRecord["collection"]>([
  ["chat.json", "chats"],
  ["AGENTS.md", "agents"],
  ["AGENT.md", "agents"],
  ["agent.json", "agents"],
  ["SKILL.md", "skills"],
]);

const KNOWN_ROOTS: readonly string[] = [...STORAGE_COLLECTIONS, "plugins"];

/**
 * Map a record that arrived without its collection folder into that collection.
 * Only a record directory itself qualifies (`chat.json` or `one/chat.json`), so
 * an unrelated archive that happens to contain such a file deeper down stays
 * untouched. A flat chat keeps its stored ID, making a re-import idempotent.
 */
async function withInferredCollections(files: ReadonlyMap<string, Blob>): Promise<Map<string, Blob>> {
  // null explicitly marks a folder with conflicting record definitions.
  const roots = new Map<string, InferredRecord | null>();
  for (const path of files.keys()) {
    const segments = path.split("/");
    const collection = RECORD_MARKERS.get(segments.at(-1)!);
    if (!collection || segments.length > 2 || KNOWN_ROOTS.includes(segments[0])) continue;
    const root = segments.length === 2 ? segments[0] : "";
    // A directory that claims two collections is not a record; leave it alone.
    if (!roots.has(root)) roots.set(root, { collection, id: root || undefined });
    else if (roots.get(root)?.collection !== collection) roots.set(root, null);
  }
  if (!roots.size) return new Map(files);

  const flat = roots.get("");
  if (flat?.collection === "chats") {
    try {
      const id: unknown = JSON.parse(await files.get("chat.json")!.text())?.id;
      if (typeof id === "string" && id) {
        if (/[/\\\0]/.test(id) || id === "." || id === "..") throw new Error(`Invalid chat id: ${id}`);
        flat.id = id;
      }
    } catch (error) {
      // restoreFiles reports malformed JSON and skips its record, including siblings.
      if (!(error instanceof SyntaxError)) throw error;
    }
  } else if (flat?.collection === "skills") {
    const parsed = parseSkillFileForImport(await files.get("SKILL.md")!.text());
    if (!parsed.success) throw new Error("Invalid skill definition: SKILL.md");
    flat.id = parsed.skill.name;
  }
  const mapped = new Map<string, Blob>();
  for (const [path, blob] of files) {
    const segments = path.split("/");
    let target = path;
    if (!KNOWN_ROOTS.includes(segments[0]) && path !== "profile.json") {
      const hasNestedRoot = segments.length > 1 && roots.has(segments[0]);
      const record = hasNestedRoot ? roots.get(segments[0]) : flat;
      if (record) {
        record.id ??= crypto.randomUUID();
        target = `${record.collection}/${record.id}/${hasNestedRoot ? segments.slice(1).join("/") : path}`;
      }
    }
    if (mapped.has(target)) throw new Error(`Conflicting archive paths resolve to ${target}`);
    mapped.set(target, blob);
  }
  return mapped;
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
): Promise<RestoreResult> {
  const files = await readZipFiles(zipBlob, (fraction) => onProgress?.(fraction * 0.5));
  const folder = folderPath.split("/").filter(Boolean).join("/");
  const reportProgress = (fraction: number) => onProgress?.(0.5 + fraction * 0.5);
  if (!folder) return restoreFiles(await withInferredCollections(files), reportProgress);

  const prefixed = [...files.keys()].some((path) => path.startsWith(`${folder}/`));
  const mapped = new Map<string, Blob>();
  for (const [path, blob] of files) {
    if (prefixed && !path.startsWith(`${folder}/`)) continue;
    mapped.set(prefixed ? path : `${folder}/${path}`, blob);
  }
  return restoreFiles(mapped, reportProgress);
}

/**
 * Export a folder as a ZIP and trigger a browser download.
 */
export async function downloadFolderAsZip(
  folderPath: string,
  filename: string,
  onProgress?: ZipProgressHandler,
): Promise<void> {
  await downloadZip(filename, () => createFolderZip(folderPath), onProgress);
}

/** Export selected top-level OPFS folders together in a single ZIP. */
export async function downloadFoldersAsZip(
  folderPaths: string[],
  filename: string,
  onProgress?: ZipProgressHandler,
): Promise<void> {
  const paths = [...new Set(folderPaths.map((path) => path.replace(/^\/+|\/+$/g, "")).filter(Boolean))].sort();
  if (!paths.length) throw new Error("Select at least one folder to export.");
  for (const path of paths) {
    if (path.includes("/")) throw new Error(`Only top-level paths can be exported: ${path}`);
  }

  await downloadZip(
    filename,
    async () => {
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
            const bytes = await readFileForZip(root, handle, path);
            if (bytes !== undefined) zip.file(path, bytes);
          } else {
            await addDirectoryToZip(handle, getZipFolder(zip, path), path);
          }
        }
      };
      const lock = (index: number): Promise<void> =>
        index === paths.length
          ? snapshot()
          : withPersistenceLock(`collection:${paths[index] === "profile.json" ? "profile" : paths[index]}`, () =>
              lock(index + 1),
            );
      await lock(0);

      return zip;
    },
    onProgress,
  );
}
