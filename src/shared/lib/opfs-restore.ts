import { parseAgentMd } from "@/features/agent/lib/agentMarkdown";
import { parseSkillFileForImport } from "@/features/skills/lib/skillParser";
import { withArtifactWorkspaceLock } from "@/features/artifacts/lib/workspaceCoordinator";
import type { IndexEntry } from "./opfs-core";
import { writeFileChanges } from "./opfs-transaction";
import { rebuildFolderIndexUnlocked, STORAGE_COLLECTIONS } from "./opfs-index";
import { isJunkZipEntry } from "./opfs-zip";
import { flushPersistence, withPersistenceLock } from "./persistence";

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
    if (!entry.dir) files.set(path, new Blob([await entry.async("arraybuffer")]));
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

async function validateMetadata(path: string, blob: Blob): Promise<void> {
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
    /^(chats\/[^/]+\/chat|agents\/[^/]+\/(servers|files\/index|files\/[^/]+\/(metadata|segments))|images\/[^/]+\/metadata)\.json$/.test(
      path,
    )
  ) {
    let value: unknown;
    try {
      value = JSON.parse(await blob.text());
    } catch {
      throw new Error(`Invalid JSON in backup: ${path}`);
    }
    if (!value || typeof value !== "object") throw new Error(`Invalid metadata in backup: ${path}`);
    if (/^chats\/.+\/chat\.json$/.test(path)) {
      const messages = (value as { messages?: unknown }).messages;
      if (
        !Array.isArray(messages) ||
        messages.some(
          (message) =>
            !message ||
            !["user", "assistant"].includes(message.role) ||
            !Array.isArray(message.content) ||
            message.content.some(
              (part: unknown) =>
                !part || typeof part !== "object" || typeof (part as { type?: unknown }).type !== "string",
            ),
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
 * Existing files with matching paths are replaced. All inputs are decoded and
 * checked first; a write failure restores the previous bytes and indexes.
 */
export async function restoreFiles(input: ReadonlyMap<string, Blob>, onProgress?: RestoreProgressHandler): Promise<void> {
  const files = new Map<string, Blob>();
  const collections = new Set<string>();
  const indexHints = new Map<string, IndexEntry[]>();
  // A deleted agent file can leave an empty metadata.json behind; drop that
  // file folder entirely so its orphaned siblings don't fail the restore.
  const skippedFileDirs = new Set<string>();
  for (const [path, blob] of input) {
    if (/^agents\/[^/]+\/files\/[^/]+\/metadata\.json$/.test(path) && !(await blob.text()).trim())
      skippedFileDirs.add(path.slice(0, path.lastIndexOf("/") + 1));
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
    collections.add(path === "profile.json" ? "profile" : root);
    // A backup's listing must not replace the destination's merged listing.
    if ((STORAGE_COLLECTIONS as readonly string[]).includes(root) && /^[^/]+\/index\.json$/.test(path)) {
      try {
        const hints: unknown = JSON.parse(await blob.text());
        if (Array.isArray(hints))
          indexHints.set(
            root,
            hints.filter((entry) => entry && typeof entry.id === "string" && typeof entry.updated === "string"),
          );
      } catch {
        /* Listings are optional hints, never authoritative backup data. */
      }
      continue;
    }
    await validateMetadata(path, blob);
    files.set(path, blob);
  }
  if (!files.size) throw new Error("No restorable files were found in the archive");
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
  const keys = [...collections].sort();
  const chatIds = [
    ...new Set([...files.keys()].flatMap((path) => (path.startsWith("chats/") ? [path.split("/")[1]] : []))),
  ].sort();

  const indexes = keys
    .filter((key) => (STORAGE_COLLECTIONS as readonly string[]).includes(key))
    .map((key) => `${key}/index.json`);
  const apply = () =>
    writeFileChanges(files, {
      extraPaths: indexes,
      afterWrite: async () => {
        for (const collection of keys) await rebuildFolderIndexUnlocked(collection, indexHints.get(collection));
      },
    });
  const lockChats = (index: number): Promise<void> =>
    index === chatIds.length ? apply() : withArtifactWorkspaceLock(chatIds[index], () => lockChats(index + 1));
  const lockCollections = (index: number): Promise<void> =>
    index === keys.length
      ? lockChats(0)
      : withPersistenceLock(`collection:${keys[index]}`, () => lockCollections(index + 1));
  await lockCollections(0);
}
