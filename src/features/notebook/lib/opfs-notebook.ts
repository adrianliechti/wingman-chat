import {
  blobToDataUrl,
  dataUrlToBlob,
  deleteDirectory,
  deleteFile,
  listDirectories,
  readBlob,
  readIndex,
  writeIndex,
  readJson,
  readText,
  removeIndexEntry,
  upsertIndexEntry,
  writeBlob,
  writeJson,
  writeText,
} from "@/shared/lib/opfs-core";
import type {
  MindMapNode,
  Notebook,
  NotebookMessage,
  NotebookOutput,
  NotebookSource,
  QuizQuestion,
} from "../types/notebook";

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
    customTitle: e.customTitle,
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
    customTitle: notebook.customTitle,
    updated: notebook.updatedAt,
  });
}

/** Update only the index timestamp (lightweight — does not rewrite notebook.json). */
export async function touchNotebook(id: string): Promise<void> {
  const index = await readIndex(COLLECTION);
  const entry = index.find((e) => e.id === id);
  if (entry) {
    entry.updated = new Date().toISOString();
    await writeIndex(COLLECTION, index);
  }
}

export async function deleteNotebook(id: string): Promise<void> {
  await deleteDirectory(notebookPath(id));
  await removeIndexEntry(COLLECTION, id);
}

// ── Sources ────────────────────────────────────────────────────────────
//
// /notebooks/{id}/sources/{sourceId}/
//   ├── metadata.json   — source metadata (no content)
//   └── content.txt     — extracted text
//
// Discovery: listDirectories() + read each metadata.json (same as agents)
// Legacy: /notebooks/{id}/sources.json — migrated on first read

// Guard against concurrent migration (React StrictMode fires effects twice)
const migrating = new Set<string>();

interface SourceMeta {
  id: string;
  type: "web" | "file";
  name: string;
  metadata?: NotebookSource["metadata"];
  addedAt: string;
}

function sourcesDir(notebookId: string) {
  return `${notebookPath(notebookId)}/sources`;
}

function sourcePath(notebookId: string, sourceId: string) {
  return `${sourcesDir(notebookId)}/${sourceId}`;
}

/** Migrate legacy sources.json → per-source directories. */
async function migrateLegacySources(notebookId: string): Promise<NotebookSource[] | undefined> {
  const legacyPath = `${notebookPath(notebookId)}/sources.json`;
  const legacy = await readJson<NotebookSource[]>(legacyPath);
  if (!legacy || legacy.length === 0) return undefined;

  for (const source of legacy) {
    const { content, ...meta } = source;
    const base = sourcePath(notebookId, source.id);
    await writeJson(`${base}/metadata.json`, meta);
    await writeText(`${base}/content.txt`, content);
  }

  await deleteFile(legacyPath);
  return legacy;
}

/** Read a single source from its directory. */
async function readSource(notebookId: string, sourceId: string): Promise<NotebookSource | undefined> {
  const base = sourcePath(notebookId, sourceId);
  const meta = await readJson<SourceMeta>(`${base}/metadata.json`);
  if (!meta) return undefined;

  const content = (await readText(`${base}/content.txt`)) || "";
  const audioBlob = await readBlob(`${base}/audio.wav`);
  const audioUrl = audioBlob ? await blobToDataUrl(audioBlob) : undefined;
  return { ...meta, content, ...(audioUrl && { audioUrl }) };
}

export async function getSources(notebookId: string): Promise<NotebookSource[]> {
  const ids = await listDirectories(sourcesDir(notebookId));

  if (ids.length === 0) {
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

  const sources = await Promise.all(ids.map((id) => readSource(notebookId, id)));
  return sources.filter((s): s is NotebookSource => s !== undefined);
}

export async function addSource(notebookId: string, source: NotebookSource): Promise<void> {
  const { content, audioUrl, ...meta } = source;
  const base = sourcePath(notebookId, source.id);

  await writeJson(`${base}/metadata.json`, meta);
  await writeText(`${base}/content.txt`, content);
  if (audioUrl) {
    await writeBlob(`${base}/audio.wav`, dataUrlToBlob(audioUrl));
  }
}

export async function removeSource(notebookId: string, sourceId: string): Promise<void> {
  await deleteDirectory(sourcePath(notebookId, sourceId));
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
  htmlSlideCount?: number;
  pptxSlideCount?: number;
  slideFormat?: string;
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
  let htmlSlideCount: number | undefined;
  if (output.htmlSlides?.length) {
    htmlSlideCount = output.htmlSlides.length;
    await writeJson(`${base}/html-slides.json`, output.htmlSlides);
  }
  let pptxSlideCount: number | undefined;
  if (output.pptxSlides?.length) {
    pptxSlideCount = output.pptxSlides.length;
    await writeJson(`${base}/pptx-slides.json`, output.pptxSlides);
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
    htmlSlideCount,
    pptxSlideCount,
    slideFormat: output.slideFormat,
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
  } else if (meta.type === "slides" && meta.pptxSlideCount) {
    output.slideFormat = (meta.slideFormat as NotebookOutput["slideFormat"]) ?? "pptx";
    const pptxSlides = await readJson<string[]>(`${base}/pptx-slides.json`);
    if (pptxSlides) output.pptxSlides = pptxSlides;
  } else if (meta.type === "slides" && meta.htmlSlideCount) {
    output.slideFormat = (meta.slideFormat as NotebookOutput["slideFormat"]) ?? "pptx";
    const htmlSlides = await readJson<string[]>(`${base}/html-slides.json`);
    if (htmlSlides) output.htmlSlides = htmlSlides;
  } else if (meta.type === "slides" && meta.slideCount) {
    output.slideFormat = (meta.slideFormat as NotebookOutput["slideFormat"]) ?? "pdf";
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
