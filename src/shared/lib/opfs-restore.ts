import { parseAgentMd } from "@/features/agent/lib/agentMarkdown";
import {
  isMemoryIndex,
  memoryPath,
  MEMORY_NOTE_MAX_BYTES,
  parseMemoryDocument,
  serializeMemoryDocument,
} from "@/features/agent/lib/memoryDocument";
import { redactSecrets } from "@/features/agent/lib/memoryHygiene";
import { validateMemoryState } from "@/features/agent/lib/memoryState";
import { prepareMemoryImport } from "@/features/agent/lib/memoryImport";
import { parseSkillFileForImport } from "@/features/skills/lib/skillParser";
import { withArtifactWorkspaceLock } from "@/features/artifacts/lib/workspaceCoordinator";
import type { IndexEntry } from "./opfs-core";
import { writeFileChanges } from "./opfs-transaction";
import { rebuildFolderIndexUnlocked, STORAGE_COLLECTIONS } from "./opfs-index";
import { isJunkZipEntry } from "./opfs-zip";
import { flushPersistence, withPersistenceLock } from "./persistence";
import { readZipEntryBlob } from "./zipStreams";

function validatePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    /[\\\0]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid archive path: ${path}`);
  }
}

/** Reports restore progress as a fraction in the range [0, 1]. */
export type RestoreProgressHandler = (fraction: number) => void;

export interface RestoreResult {
  restoredFiles: number;
  skipped: Array<{ path: string; reason: string }>;
}

class InvalidBackupJsonError extends Error {}

function recordScope(path: string): string {
  return path.match(/^(?:agents|chats|images|plugins)\/[^/]+\//)?.[0] ?? path;
}

/** Decode and validate the entire archive before changing any saved files. */
export async function readZipFiles(blob: Blob, onProgress?: RestoreProgressHandler): Promise<Map<string, Blob>> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true });
  const files = new Map<string, Blob>();
  const entries = Object.entries(zip.files);
  let processed = 0;
  for (const [path, entry] of entries) {
    processed += 1;
    onProgress?.(processed / entries.length);
    if (isJunkZipEntry(path)) continue;
    const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (original) validatePath(original.replace(/\/$/, ""));
    validatePath(path.replace(/\/$/, ""));
    if (!entry.dir) files.set(path, await readZipEntryBlob(entry));
  }
  // Accept a full backup wrapped in a download folder without requiring users
  // to rearrange its contents. Collection and single-record layouts stay intact.
  while (files.size) {
    const paths = [...files.keys()];
    const prefix = paths[0].split("/")[0];
    if (
      (STORAGE_COLLECTIONS as readonly string[]).includes(prefix) ||
      !paths.every((path) => path.startsWith(`${prefix}/`))
    )
      break;
    const stripped = paths.map((path) => path.slice(prefix.length + 1));
    if (
      !stripped.some(
        (path) => (STORAGE_COLLECTIONS as readonly string[]).includes(path.split("/")[0]) || path === "profile.json",
      )
    )
      break;
    const contents = [...files.values()];
    files.clear();
    stripped.forEach((path, index) => files.set(path, contents[index]));
  }
  return files;
}

function parseBackupJson(path: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidBackupJsonError(`Invalid JSON in backup: ${path}`);
  }
}

async function validateMetadata(path: string, blob: Blob): Promise<void> {
  const memory = path.match(/^agents\/[^/]+\/memory\/(.+)$/);
  if (memory) {
    memoryPath(`/.memory/${memory[1]}`);
    if (!memory[1].endsWith(".md")) throw new Error(`Memory imports must be Markdown: ${path}`);
    if (!isMemoryIndex(memory[1])) {
      if (blob.size > MEMORY_NOTE_MAX_BYTES) throw new Error(`Memory note exceeds 8 KiB: ${path}`);
      parseMemoryDocument(await blob.text());
    }
    return;
  }
  if (/^agents\/[^/]+\/memory-state\.json$/.test(path)) {
    validateMemoryState(parseBackupJson(path, await blob.text()));
    return;
  }
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) {
    const parsed = parseSkillFileForImport(await blob.text());
    if (!parsed.success || parsed.skill.name !== path.split("/")[1])
      throw new Error(`Invalid skill definition: ${path}`);
    return;
  }
  if (/^agents\/[^/]+\/AGENTS?\.md$/.test(path)) {
    if (!parseAgentMd(await blob.text())) throw new Error(`Invalid agent definition: ${path}`);
    return;
  }
  if (
    path === "profile.json" ||
    /^(chats\/(?:[^/]+\/chat|[^/]+)|agents\/[^/]+\/(agent|servers|files\/index|files\/[^/]+\/(metadata|segments))|images\/[^/]+\/metadata|plugins\/[^/]+\/plugin)\.json$/.test(
      path,
    )
  ) {
    const value = parseBackupJson(path, await blob.text());
    if (!value || typeof value !== "object") throw new Error(`Invalid metadata in backup: ${path}`);
    if (/^chats\/(?:[^/]+\/chat|[^/]+)\.json$/.test(path)) {
      // The native transcript keeps `parts`; chats saved before it keep `content` and migrate on load.
      const messages = (value as { messages?: unknown }).messages;
      const typedParts = (parts: unknown) =>
        Array.isArray(parts) &&
        parts.every(
          (part: unknown) =>
            !!part && typeof part === "object" && typeof (part as { type?: unknown }).type === "string",
        );
      if (
        !Array.isArray(messages) ||
        messages.some(
          (message) =>
            !message ||
            !["user", "assistant", "system"].includes(message.role) ||
            !(typedParts(message.parts) || typedParts(message.content)),
        )
      )
        throw new Error(`Invalid chat in backup: ${path}`);
    }
    if (/\/(servers|files\/index|segments)\.json$/.test(path) && !Array.isArray(value))
      throw new Error(`Invalid list in backup: ${path}`);
    if (/\/(files\/index|segments)\.json$/.test(path) && (value as unknown[]).some((item) => typeof item !== "string"))
      throw new Error(`Invalid list entries in backup: ${path}`);
    if (path.endsWith("/metadata.json") && Array.isArray(value)) throw new Error(`Invalid metadata in backup: ${path}`);
    if (path === "profile.json" && Array.isArray(value)) throw new Error("Invalid profile in backup");
  }
}

/**
 * Merge supplied files, preserving everything absent from a partial backup.
 * Malformed JSON skips its owning record; arbitrary artifact files stay opaque.
 * Accepted files are checked first; a write failure restores previous bytes and indexes.
 */
export async function restoreFiles(
  input: ReadonlyMap<string, Blob>,
  onProgress?: RestoreProgressHandler,
): Promise<RestoreResult> {
  const files = new Map<string, Blob>();
  const indexHints = new Map<string, IndexEntry[]>();
  const skipped: RestoreResult["skipped"] = [];
  const skippedRecords = new Set<string>();
  // A deleted agent file can leave an empty metadata.json behind; drop that
  // file folder entirely so its orphaned siblings don't fail the restore.
  const skippedFileDirs = new Set<string>();
  for (const [path, blob] of input) {
    if (/^agents\/[^/]+\/files\/[^/]+\/metadata\.json$/.test(path) && !(await blob.text()).trim()) {
      skippedFileDirs.add(path.slice(0, path.lastIndexOf("/") + 1));
      skipped.push({ path, reason: "Empty file metadata; skipped the file folder." });
    }
  }
  const isSkipped = (path: string) => [...skippedFileDirs].some((dir) => path.startsWith(dir));
  let validated = 0;
  for (const [path, blob] of input) {
    validated += 1;
    onProgress?.(input.size ? validated / input.size : 1);
    validatePath(path);
    if (isSkipped(path)) continue;
    const root = path.split("/")[0];
    // A full OPFS backup may also contain older collections and additional
    // user files. Preserve them without inventing sidebar records for them.
    // A backup's listing must not replace the destination's merged listing.
    if ((STORAGE_COLLECTIONS as readonly string[]).includes(root) && /^[^/]+\/index\.json$/.test(path)) {
      try {
        const hints = parseBackupJson(path, await blob.text());
        if (Array.isArray(hints))
          indexHints.set(
            root,
            hints.filter((entry) => entry && typeof entry.id === "string" && typeof entry.updated === "string"),
          );
      } catch (error) {
        if (!(error instanceof InvalidBackupJsonError)) throw error;
        skipped.push({ path, reason: "Invalid JSON in the optional index; rebuilt it from saved records." });
      }
      continue;
    }
    try {
      await validateMetadata(path, blob);
    } catch (error) {
      if (!(error instanceof InvalidBackupJsonError)) throw error;
      const scope = recordScope(path);
      skippedRecords.add(scope);
      skipped.push({ path, reason: `Invalid JSON; skipped ${scope}.` });
      continue;
    }
    if (/^agents\/[^/]+\/memory\/.+\.md$/.test(path) && !isMemoryIndex(path)) {
      const normalized = new Blob([
        serializeMemoryDocument(parseMemoryDocument(redactSecrets(await blob.text()).text)),
      ]);
      if (normalized.size > MEMORY_NOTE_MAX_BYTES)
        throw new Error(`Memory note including metadata exceeds 8 KiB: ${path}`);
      files.set(path, normalized);
    } else {
      files.set(path, blob);
    }
  }
  // Filter after validation so ZIP entry order cannot leave half a skipped record.
  for (const path of files.keys()) {
    if (skippedRecords.has(recordScope(path))) files.delete(path);
  }
  if (!files.size) {
    if (skipped.length) return { restoredFiles: 0, skipped };
    throw new Error("No restorable files were found in the archive");
  }
  for (const [path, blob] of files) {
    if (!/^agents\/[^/]+\/files\/[^/]+\/embeddings\.bin$/.test(path)) continue;
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength < 4 || bytes.byteLength % 4) throw new Error(`Invalid embeddings in backup: ${path}`);
    const vectors = new Float32Array(bytes);
    const dimension = vectors[0];
    const texts = files.get(path.replace(/embeddings\.bin$/, "segments.json"));
    const count = texts ? (JSON.parse(await texts.text()) as string[]).length : undefined;
    if (
      !Number.isInteger(dimension) ||
      dimension <= 0 ||
      (vectors.length - 1) % dimension ||
      vectors.some((value) => !Number.isFinite(value)) ||
      (count !== undefined && vectors.length !== 1 + count * dimension)
    )
      throw new Error(`Invalid embeddings in backup: ${path}`);
  }
  await flushPersistence();
  const keys = [
    ...new Set([...files.keys()].map((path) => (path === "profile.json" ? "profile" : path.split("/")[0]))),
  ].sort();
  const chatIds = [
    ...new Set([...files.keys()].flatMap((path) => (path.startsWith("chats/") ? [path.split("/")[1]] : []))),
  ].sort();

  const indexes = keys
    .filter((key) => (STORAGE_COLLECTIONS as readonly string[]).includes(key))
    .map((key) => `${key}/index.json`);
  const apply = async () => {
    const changes = new Map<string, Blob | undefined>(files);
    await prepareMemoryImport(changes);
    return writeFileChanges(changes, {
      extraPaths: indexes,
      afterWrite: async () => {
        for (const collection of keys) await rebuildFolderIndexUnlocked(collection, indexHints.get(collection));
      },
    });
  };
  const lockChats = (index: number): Promise<void> =>
    index === chatIds.length ? apply() : withArtifactWorkspaceLock(chatIds[index], () => lockChats(index + 1));
  const lockCollections = (index: number): Promise<void> =>
    index === keys.length
      ? lockChats(0)
      : withPersistenceLock(`collection:${keys[index]}`, () => lockCollections(index + 1));
  await lockCollections(0);
  return { restoredFiles: files.size, skipped };
}
