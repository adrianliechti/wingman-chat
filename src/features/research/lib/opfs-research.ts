import {
  readJson,
  writeJson,
  deleteDirectory,
  listDirectories,
  readIndex,
  upsertIndexEntry,
  removeIndexEntry,
} from '@/shared/lib/opfs-core';
import type {
  Research,
  ResearchSource,
  ResearchOutput,
  ResearchMessage,
} from '../types/research';

const COLLECTION = 'researches';

function researchPath(id: string) {
  return `${COLLECTION}/${id}`;
}

// ── Research CRUD ──────────────────────────────────────────────────────

export async function listResearches(): Promise<Research[]> {
  const index = await readIndex(COLLECTION);
  return index.map((e) => ({
    id: e.id,
    title: e.title || 'Untitled',
    createdAt: e.updated,
    updatedAt: e.updated,
  }));
}

export async function getResearch(id: string): Promise<Research | undefined> {
  return readJson<Research>(`${researchPath(id)}/research.json`);
}

export async function saveResearch(research: Research): Promise<void> {
  await writeJson(`${researchPath(research.id)}/research.json`, research);
  await upsertIndexEntry(COLLECTION, {
    id: research.id,
    title: research.title,
    updated: research.updatedAt,
  });
}

export async function deleteResearch(id: string): Promise<void> {
  await deleteDirectory(researchPath(id));
  await removeIndexEntry(COLLECTION, id);
}

// ── Sources ────────────────────────────────────────────────────────────

export async function getSources(researchId: string): Promise<ResearchSource[]> {
  const data = await readJson<ResearchSource[]>(
    `${researchPath(researchId)}/sources.json`,
  );
  return data || [];
}

export async function saveSources(
  researchId: string,
  sources: ResearchSource[],
): Promise<void> {
  await writeJson(`${researchPath(researchId)}/sources.json`, sources);
}

export async function addSource(
  researchId: string,
  source: ResearchSource,
): Promise<ResearchSource[]> {
  const sources = await getSources(researchId);
  sources.push(source);
  await saveSources(researchId, sources);
  return sources;
}

export async function removeSource(
  researchId: string,
  sourceId: string,
): Promise<ResearchSource[]> {
  const sources = await getSources(researchId);
  const filtered = sources.filter((s) => s.id !== sourceId);
  await saveSources(researchId, filtered);
  return filtered;
}

// ── Outputs ────────────────────────────────────────────────────────────

export async function getOutputs(researchId: string): Promise<ResearchOutput[]> {
  const data = await readJson<ResearchOutput[]>(
    `${researchPath(researchId)}/outputs.json`,
  );
  return data || [];
}

export async function saveOutputs(
  researchId: string,
  outputs: ResearchOutput[],
): Promise<void> {
  await writeJson(`${researchPath(researchId)}/outputs.json`, outputs);
}

export async function addOutput(
  researchId: string,
  output: ResearchOutput,
): Promise<ResearchOutput[]> {
  const outputs = await getOutputs(researchId);
  outputs.push(output);
  await saveOutputs(researchId, outputs);
  return outputs;
}

export async function removeOutput(
  researchId: string,
  outputId: string,
): Promise<ResearchOutput[]> {
  const outputs = await getOutputs(researchId);
  const filtered = outputs.filter((o) => o.id !== outputId);
  await saveOutputs(researchId, filtered);
  return filtered;
}

// ── Messages ───────────────────────────────────────────────────────────

export async function getMessages(researchId: string): Promise<ResearchMessage[]> {
  const data = await readJson<ResearchMessage[]>(
    `${researchPath(researchId)}/messages.json`,
  );
  return data || [];
}

export async function saveMessages(
  researchId: string,
  messages: ResearchMessage[],
): Promise<void> {
  await writeJson(`${researchPath(researchId)}/messages.json`, messages);
}
