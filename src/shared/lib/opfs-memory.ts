/**
 * OPFS Memory — Agent memory bundle CRUD.
 *
 * Each agent's memory is an Open Knowledge Format (OKF v0.1) bundle under
 * /agents/{agentId}/memory/. The bundle logic lives in
 * @/features/agent/lib/memoryStore (filesystem-agnostic, unit-tested); this
 * module binds it to OPFS and exposes agent-scoped helpers. Mirrors the
 * conventions used by the skills bundle — see opfs-skills.ts.
 */

import type { MemoryDoc, MemoryFrontmatter } from "@/features/agent/lib/memoryParser";
import { createMemoryStore, type MemoryEntry, type MemoryStore } from "@/features/agent/lib/memoryStore";
import { deleteFile, fileExists, listFiles, readFileMetadata, readText, writeText } from "./opfs-core";

export type { MemoryDoc, MemoryFrontmatter } from "@/features/agent/lib/memoryParser";
export type { MemoryEntry } from "@/features/agent/lib/memoryStore";

const stores = new Map<string, MemoryStore>();

/** The OPFS-backed store for one agent. Cached so mutations stay serialized per agent. */
export function getMemoryStore(agentId: string): MemoryStore {
  let store = stores.get(agentId);
  if (!store) {
    store = createMemoryStore(
      { readText, writeText, deleteFile, listFiles, fileExists, readFileMetadata },
      { dir: `agents/${agentId}/memory`, legacyPath: `agents/${agentId}/MEMORY.md` },
    );
    stores.set(agentId, store);
  }
  return store;
}

/** List every concept doc in an agent's memory bundle (frontmatter only, no bodies). */
export function listMemoryEntries(agentId: string): Promise<MemoryEntry[]> {
  return getMemoryStore(agentId).list();
}

/** Read one memory concept doc (frontmatter + body). */
export function readMemoryDoc(agentId: string, path: string): Promise<MemoryDoc | undefined> {
  return getMemoryStore(agentId).read(path);
}

/** Read the compact, always-safe-to-inject index.md (table of contents). */
export function readMemoryIndex(agentId: string): Promise<string> {
  return getMemoryStore(agentId).readIndex();
}

/** Create or update one memory concept doc. Refreshes index.md and appends to log.md. */
export function writeMemoryDoc(
  agentId: string,
  path: string,
  frontmatter: Omit<MemoryFrontmatter, "timestamp">,
  body: string,
): Promise<MemoryEntry> {
  return getMemoryStore(agentId).write(path, frontmatter, body);
}

/** Delete one memory concept doc. Refreshes index.md and appends to log.md. */
export async function deleteMemoryDoc(agentId: string, path: string): Promise<void> {
  await getMemoryStore(agentId).delete(path);
}

/** One-time migration from the old single-file MEMORY.md into the bundle format. */
export function ensureMemoryMigrated(agentId: string): Promise<void> {
  return getMemoryStore(agentId).ensureMigrated();
}
