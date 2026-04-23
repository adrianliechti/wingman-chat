import {
  blobToDataUrl,
  dataUrlToBlob,
  deleteDirectory,
  deleteFile,
  listDirectories,
  readBlob,
  readIndex,
  readJson,
  readText,
  removeIndexEntry,
  upsertIndexEntry,
  writeBlob,
  writeJson,
  writeText,
} from "@/shared/lib/opfs-core";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import type {
  MindMapNode,
  Notebook,
  NotebookMessage,
  NotebookOutput,
  QuizQuestion,
} from "../types/notebook";
import type { File } from "@/shared/types/file";

const COLLECTION = "notebooks";

function notebookPath(id: string) {
  return `${COLLECTION}/${id}`;
}

// ── Notebook CRUD ──────────────────────────────────────────────────────

export async function listNotebooks(): Promise<Notebook[]> {
  const index = await readIndex(COLLECTION);
  return index.map((e) => ({
    id: e.id,
    title: e.title || "Untitled",
    createdAt: e.updated,
    updatedAt: e.updated,
  }));
}

export async function getNotebook(id: string): Promise<Notebook | undefined> {
  return readJson<Notebook>(`${notebookPath(id)}/notebook.json`);
}

export async function saveNotebook(notebook: Notebook): Promise<void> {
  await writeJson(`${notebookPath(notebook.id)}/notebook.json`, notebook);
  await upsertIndexEntry(COLLECTION, {
    id: notebook.id,
    title: notebook.title,
    updated: notebook.updatedAt,
  });
}

export async function deleteNotebook(id: string): Promise<void> {
  await deleteDirectory(notebookPath(id));
  await removeIndexEntry(COLLECTION, id);
}

// ── Sources ────────────────────────────────────────────────────────────
//
// /notebooks/{id}/sources/{encodedPath}/
//   ├── content.txt     — extracted text
//   └── audio.wav       — optional audio blob (voice recordings)
//
// Source ids are normalized paths (e.g. "research-notes.md",
// "reports/q3.md"). Storage directory names are URI-encoded so nested
// paths don't create real OPFS subdirectories (keeps listing flat).
//
// Discovery: listDirectories() + read each content.txt
// Legacy: /notebooks/{id}/sources.json — migrated on first read
// Legacy: per-source metadata.json — ignored (no longer read or written)

// Guard against concurrent migration (React StrictMode fires effects twice)
const migrating = new Set<string>();

function sourcesDir(notebookId: string) {
  return `${notebookPath(notebookId)}/sources`;
}

function sourceDir(notebookId: string, path: string) {
  return `${sourcesDir(notebookId)}/${encodeURIComponent(path)}`;
}

/**
 * Normalize a user- or LLM-supplied path for use as a source id.
 *
 * Rules:
 * - Leading/trailing slashes are stripped (notebook is the root).
 * - Multiple consecutive slashes are collapsed.
 * - Empty segments, ".", and ".." are rejected (no escaping the notebook).
 * - Whitespace at segment boundaries is trimmed.
 * - Returns "" if the input is empty.
 */
export function normalizeSourcePath(raw: string): string {
  if (!raw) return "";
  const parts = raw
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  for (const p of parts) {
    if (p === "." || p === "..") {
      throw new Error(`Invalid path segment: "${p}"`);
    }
  }

  return parts.join("/");
}

/**
 * Append a default extension to the last path segment if it has none.
 * Short trailing tokens (1–5 chars, alphanumeric) are treated as existing
 * extensions. `ext` should be provided without a leading dot.
 */
export function withDefaultExtension(path: string, ext: string): string {
  if (!path) return path;
  const slash = path.lastIndexOf("/");
  const last = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = last.lastIndexOf(".");
  const hasExt = dot > 0 && /^[a-z0-9]{1,5}$/i.test(last.slice(dot + 1));
  return hasExt ? path : `${path}.${ext.replace(/^\./, "")}`;
}

/** Migrate legacy sources.json → per-source content files. */
async function migrateLegacySources(notebookId: string): Promise<File[] | undefined> {
  const legacyPath = `${notebookPath(notebookId)}/sources.json`;
  const legacy = await readJson<Array<{ id?: string; path?: string; content: string; audioUrl?: string }>>(legacyPath);
  if (!legacy || legacy.length === 0) return undefined;

  const migrated: File[] = [];
  for (const source of legacy) {
    const path = source.path ?? source.id ?? "";
    if (!path) continue;
    await addSource(notebookId, { path, content: source.content });
    migrated.push({ path, content: source.content });

    // Legacy sources with audio become a separate .wav source.
    if (source.audioUrl) {
      const wavPath = withDefaultExtension(path.replace(/\.[a-z0-9]{1,5}$/i, ""), "wav");
      const blob = dataUrlToBlob(source.audioUrl);
      const dataUrl = await blobToDataUrl(blob);
      await addSource(notebookId, { path: wavPath, content: dataUrl, contentType: "audio/wav" });
      migrated.push({ path: wavPath, content: dataUrl, contentType: "audio/wav" });
    }
  }

  await deleteFile(legacyPath);
  return migrated;
}

/** Read a single source from its directory. */
async function readSource(notebookId: string, path: string): Promise<File | undefined> {
  const base = sourceDir(notebookId, path);
  const contentType = inferContentTypeFromPath(path);

  if (isTextContentType(contentType)) {
    const content = await readText(`${base}/content`);
    if (content == null) {
      // Legacy layout: content.txt + optional audio.wav, with a metadata.json.
      return readLegacySource(notebookId, path);
    }
    return { path, content, ...(contentType && { contentType }) };
  }

  const blob = await readBlob(`${base}/content`);
  if (!blob) {
    return readLegacySource(notebookId, path);
  }
  const dataUrl = await blobToDataUrl(blob);
  return { path, content: dataUrl, contentType: contentType ?? "application/octet-stream" };
}

/**
 * Read a source in the old `content.txt` + `audio.wav` + `metadata.json`
 * layout. Returns only the text part — audio is surfaced via a lazy
 * best-effort migration that splits it off as a separate source on next write.
 */
async function readLegacySource(notebookId: string, path: string): Promise<File | undefined> {
  const base = sourceDir(notebookId, path);
  const content = await readText(`${base}/content.txt`);
  if (content == null) return undefined;
  const contentType = inferContentTypeFromPath(path);
  return { path, content, ...(contentType && { contentType }) };
}

export async function getSources(notebookId: string): Promise<File[]> {
  const entries = await listDirectories(sourcesDir(notebookId));
  // Stored dir names are URI-encoded; decode back to the source path.
  const paths = entries.map((name) => {
    try {
      return decodeURIComponent(name);
    } catch {
      // Legacy entries (pre-encoding) — use as-is.
      return name;
    }
  });

  if (paths.length === 0) {
    const key = `sources:${notebookId}`;
    if (migrating.has(key)) return [];
    migrating.add(key);
    try {
      const migrated = await migrateLegacySources(notebookId);
      return migrated || [];
    } finally {
      migrating.delete(key);
    }
  }

  const sources = await Promise.all(paths.map((p) => readSource(notebookId, p)));
  return sources.filter((s): s is File => s !== undefined);
}

export async function addSource(notebookId: string, source: File): Promise<void> {
  const base = sourceDir(notebookId, source.path);
  const contentType = source.contentType ?? inferContentTypeFromPath(source.path);

  if (isTextContentType(contentType) && !isDataUrl(source.content)) {
    await writeText(`${base}/content`, source.content);
  } else {
    // Binary payload stored as a data URL — decode to a blob on disk.
    const blob = isDataUrl(source.content)
      ? dataUrlToBlob(source.content)
      : new Blob([source.content], { type: contentType ?? "application/octet-stream" });
    await writeBlob(`${base}/content`, blob);
  }

  // Clean up any stale legacy files (migration from the old per-source layout).
  await deleteFile(`${base}/content.txt`).catch(() => {});
  await deleteFile(`${base}/metadata.json`).catch(() => {});
  await deleteFile(`${base}/audio.wav`).catch(() => {});
}

export async function removeSource(notebookId: string, path: string): Promise<void> {
  await deleteDirectory(sourceDir(notebookId, path));
}

function isDataUrl(value: string): boolean {
  return typeof value === "string" && value.startsWith("data:");
}

// ── Outputs ────────────────────────────────────────────────────────────
//
// /notebooks/{id}/outputs/{outputId}/
//   ├── metadata.json   — output metadata
//   ├── content.txt     — text content (script, markdown, etc.)
//   ├── audio.wav       — audio blob (podcast)
//   ├── image.png       — infographic image
//   ├── quiz.json       — quiz questions
//   ├── mindmap.json    — mind map tree
//   └── slides/         — slide images (slides)
//       ├── 000.png
//       ├── 001.png
//       └── ...
//
// Discovery: listDirectories() + read each metadata.json (same as agents)
// Legacy: /notebooks/{id}/outputs.json — migrated on first read

interface OutputMeta {
  id: string;
  type: NotebookOutput["type"];
  title: string;
  status: NotebookOutput["status"];
  error?: string;
  createdAt: string;
  slideCount?: number;
}

function outputsDir(notebookId: string) {
  return `${notebookPath(notebookId)}/outputs`;
}

function outputPath(notebookId: string, outputId: string) {
  return `${outputsDir(notebookId)}/${outputId}`;
}

/** Migrate legacy outputs.json → per-output directories. */
async function migrateLegacyOutputs(notebookId: string): Promise<NotebookOutput[] | undefined> {
  const legacyPath = `${notebookPath(notebookId)}/outputs.json`;
  const legacy = await readJson<NotebookOutput[]>(legacyPath);
  if (!legacy || legacy.length === 0) return undefined;

  for (const output of legacy) {
    await writeOutput(notebookId, output);
  }

  await deleteFile(legacyPath);
  return legacy;
}

/** Write a single output to its directory. */
async function writeOutput(notebookId: string, output: NotebookOutput): Promise<void> {
  const base = outputPath(notebookId, output.id);

  // Text content
  if (output.content) {
    await writeText(`${base}/content.txt`, output.content);
  }

  // Type-specific binary/structured data
  let slideCount: number | undefined;

  if (output.audioUrl) {
    await writeBlob(`${base}/audio.wav`, dataUrlToBlob(output.audioUrl));
  }
  if (output.imageUrl) {
    await writeBlob(`${base}/image.png`, dataUrlToBlob(output.imageUrl));
  }
  if (output.slides?.length) {
    slideCount = output.slides.length;
    await Promise.all(
      output.slides.map(async (dataUrl, i) => {
        if (dataUrl) {
          await writeBlob(`${base}/slides/${String(i).padStart(3, "0")}.png`, dataUrlToBlob(dataUrl));
        }
      }),
    );
  }
  if (output.quiz) {
    await writeJson(`${base}/quiz.json`, output.quiz);
  }
  if (output.mindMap) {
    await writeJson(`${base}/mindmap.json`, output.mindMap);
  }

  // Metadata (source of truth for listing)
  const meta: OutputMeta = {
    id: output.id,
    type: output.type,
    title: output.title,
    status: output.status,
    error: output.error,
    createdAt: output.createdAt,
    slideCount,
  };
  await writeJson(`${base}/metadata.json`, meta);
}

/** Rehydrate a single output from its directory. */
async function readOutput(notebookId: string, outputId: string): Promise<NotebookOutput | undefined> {
  const base = outputPath(notebookId, outputId);
  const meta = await readJson<OutputMeta>(`${base}/metadata.json`);
  if (!meta) return undefined;

  const content = (await readText(`${base}/content.txt`)) || "";

  const output: NotebookOutput = {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    content,
    status: meta.status,
    error: meta.error,
    createdAt: meta.createdAt,
  };

  // Load type-specific data
  if (meta.type === "podcast") {
    const blob = await readBlob(`${base}/audio.wav`);
    if (blob) output.audioUrl = await blobToDataUrl(blob);
  } else if (meta.type === "infographic") {
    const blob = await readBlob(`${base}/image.png`);
    if (blob) output.imageUrl = await blobToDataUrl(blob);
  } else if (meta.type === "slides" && meta.slideCount) {
    const slides: string[] = [];
    for (let i = 0; i < meta.slideCount; i++) {
      // Try padded name first (000.png), fall back to unpadded (0.png) for older data
      const blob =
        (await readBlob(`${base}/slides/${String(i).padStart(3, "0")}.png`)) ??
        (await readBlob(`${base}/slides/${i}.png`));
      slides.push(blob ? await blobToDataUrl(blob) : "");
    }
    output.slides = slides;
  } else if (meta.type === "quiz") {
    const quiz = await readJson<QuizQuestion[]>(`${base}/quiz.json`);
    if (quiz) output.quiz = quiz;
  } else if (meta.type === "mindmap") {
    const mindMap = await readJson<MindMapNode>(`${base}/mindmap.json`);
    if (mindMap) output.mindMap = mindMap;
  }

  return output;
}

export async function getOutputs(notebookId: string): Promise<NotebookOutput[]> {
  const ids = await listDirectories(outputsDir(notebookId));

  if (ids.length === 0) {
    const key = `outputs:${notebookId}`;
    if (migrating.has(key)) return [];
    migrating.add(key);
    try {
      const migrated = await migrateLegacyOutputs(notebookId);
      return migrated || [];
    } finally {
      migrating.delete(key);
    }
  }

  const outputs = await Promise.all(ids.map((id) => readOutput(notebookId, id)));
  return outputs.filter((o): o is NotebookOutput => o !== undefined);
}

export async function addOutput(notebookId: string, output: NotebookOutput): Promise<void> {
  await writeOutput(notebookId, output);
}

export async function removeOutput(notebookId: string, outputId: string): Promise<void> {
  await deleteDirectory(outputPath(notebookId, outputId));
}

// ── Messages ───────────────────────────────────────────────────────────

export async function getMessages(notebookId: string): Promise<NotebookMessage[]> {
  const data = await readJson<NotebookMessage[]>(`${notebookPath(notebookId)}/messages.json`);
  return data || [];
}

export async function saveMessages(notebookId: string, messages: NotebookMessage[]): Promise<void> {
  await writeJson(`${notebookPath(notebookId)}/messages.json`, messages);
}
