import {
  readJson,
  writeJson,
  deleteDirectory,
  readIndex,
  upsertIndexEntry,
  removeIndexEntry,
} from '@/shared/lib/opfs-core';
import type {
  Notebook,
  NotebookSource,
  NotebookOutput,
  NotebookMessage,
} from '../types/notebook';

const COLLECTION = 'notebooks';

function notebookPath(id: string) {
  return `${COLLECTION}/${id}`;
}

// ── Notebook CRUD ──────────────────────────────────────────────────────

export async function listNotebooks(): Promise<Notebook[]> {
  const index = await readIndex(COLLECTION);
  return index.map((e) => ({
    id: e.id,
    title: e.title || 'Untitled',
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

export async function getSources(notebookId: string): Promise<NotebookSource[]> {
  const data = await readJson<NotebookSource[]>(
    `${notebookPath(notebookId)}/sources.json`,
  );
  return data || [];
}

export async function saveSources(
  notebookId: string,
  sources: NotebookSource[],
): Promise<void> {
  await writeJson(`${notebookPath(notebookId)}/sources.json`, sources);
}

export async function addSource(
  notebookId: string,
  source: NotebookSource,
): Promise<NotebookSource[]> {
  const sources = await getSources(notebookId);
  sources.push(source);
  await saveSources(notebookId, sources);
  return sources;
}

export async function removeSource(
  notebookId: string,
  sourceId: string,
): Promise<NotebookSource[]> {
  const sources = await getSources(notebookId);
  const filtered = sources.filter((s) => s.id !== sourceId);
  await saveSources(notebookId, filtered);
  return filtered;
}

// ── Outputs ────────────────────────────────────────────────────────────

export async function getOutputs(notebookId: string): Promise<NotebookOutput[]> {
  const data = await readJson<NotebookOutput[]>(
    `${notebookPath(notebookId)}/outputs.json`,
  );
  return data || [];
}

export async function saveOutputs(
  notebookId: string,
  outputs: NotebookOutput[],
): Promise<void> {
  await writeJson(`${notebookPath(notebookId)}/outputs.json`, outputs);
}

export async function addOutput(
  notebookId: string,
  output: NotebookOutput,
): Promise<NotebookOutput[]> {
  const outputs = await getOutputs(notebookId);
  outputs.push(output);
  await saveOutputs(notebookId, outputs);
  return outputs;
}

export async function removeOutput(
  notebookId: string,
  outputId: string,
): Promise<NotebookOutput[]> {
  const outputs = await getOutputs(notebookId);
  const filtered = outputs.filter((o) => o.id !== outputId);
  await saveOutputs(notebookId, filtered);
  return filtered;
}

// ── Messages ───────────────────────────────────────────────────────────

export async function getMessages(notebookId: string): Promise<NotebookMessage[]> {
  const data = await readJson<NotebookMessage[]>(
    `${notebookPath(notebookId)}/messages.json`,
  );
  return data || [];
}

export async function saveMessages(
  notebookId: string,
  messages: NotebookMessage[],
): Promise<void> {
  await writeJson(`${notebookPath(notebookId)}/messages.json`, messages);
}
