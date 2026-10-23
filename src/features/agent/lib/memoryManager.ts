import * as opfs from "@/shared/lib/opfs-core";
import { writeFileChanges } from "@/shared/lib/opfs-transaction";
import { withPersistenceLock } from "@/shared/lib/persistence";
import type { File } from "@/shared/types/file";
import type { WritableFileSource } from "@/shared/lib/file-tools";
import { parseAgentMd } from "./agentMarkdown";
import {
  boundMemoryText,
  bytes,
  isMemoryIndex,
  MEMORY_BUNDLE_MAX_BYTES,
  MEMORY_MAX_NOTES,
  MEMORY_NOTE_MAX_BYTES,
  MEMORY_ROOT,
  memoryIndexes,
  memoryPath,
  memoryRevision,
  parseMemoryDocument,
  serializeMemoryDocument,
} from "./memoryDocument";
import { publishMemoryChange } from "./memoryEvents";
import { redactSecrets } from "./memoryHygiene";
import { emptyMemoryState, validateMemoryState, type MemoryState } from "./memoryState";

export interface MemorySnapshot {
  files: Map<string, string>;
  state: MemoryState;
}

export interface MemoryTransaction extends MemorySnapshot {
  source: WritableFileSource;
  /** Suppress pending and previously sourced candidates after a deliberate change. */
  invalidateLearning(paths: string[]): Promise<void>;
}

export interface MemoryAccess {
  writable?: boolean;
  /** Expected content hashes, checked under the same lock as the mutation. */
  observed?: ReadonlyMap<string, string | undefined>;
  source?: { resource: string };
  actor?: string;
  requireEnabled?: boolean;
  lockSources?: boolean;
}

export async function listMemoryTree(dir: string, prefix = ""): Promise<string[]> {
  const files = (await opfs.listFiles(`${dir}/${prefix}`)).map((name) => `${prefix}${name}`);
  for (const name of await opfs.listDirectories(`${dir}/${prefix}`)) {
    if (!name.startsWith(".")) files.push(...(await listMemoryTree(dir, `${prefix}${name}/`)));
  }
  return files;
}

/** Owns note transactions, generated indexes, migration and learning state. */
export class MemoryManager {
  readonly directory: string;
  readonly statePath: string;
  readonly agentId: string;

  constructor(agentId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error("Invalid memory owner.");
    this.agentId = agentId;
    this.directory = `agents/${agentId}/memory`;
    this.statePath = `agents/${agentId}/memory-state.json`;
  }

  async settings() {
    const md =
      (await opfs.readText(`agents/${this.agentId}/AGENTS.md`)) ??
      (await opfs.readText(`agents/${this.agentId}/AGENT.md`));
    return md ? parseAgentMd(md) : undefined;
  }

  async transaction<T>(operation: (memory: MemoryTransaction) => Promise<T>, access: MemoryAccess = {}): Promise<T> {
    let changed = false;
    const withSources = (perform: () => Promise<T>) =>
      access.lockSources ? withPersistenceLock("collection:chats", perform) : perform();
    const result = await withPersistenceLock("collection:agents", () =>
      withPersistenceLock(`memory:${this.agentId}`, () =>
        withSources(async () => {
          const settings = await this.settings();
          if (!settings) throw new Error("The memory's agent no longer exists.");
          if ((access.writable || access.requireEnabled) && !settings.memory)
            throw new Error("Memory is disabled for this agent.");
          const storedState = await opfs.readJson<MemoryState>(this.statePath);
          const state = storedState ?? emptyMemoryState();
          validateMemoryState(state);
          const original = new Map<string, string>();
          for (const path of await listMemoryTree(this.directory)) {
            if (!path.endsWith(".md") || path.split("/").some((part) => part.startsWith("."))) continue;
            const text = await opfs.readText(`${this.directory}/${path}`);
            if (text !== undefined) original.set(path, text);
          }
          // Optional imported OKF logs are retained and readable, never recalled.
          const files = new Map([...original].filter(([path]) => !/(?:^|\/)index\.md$/.test(path)));
          const initialState = JSON.stringify(state);
          const legacyPath = `agents/${this.agentId}/MEMORY.md`;
          const legacy = !storedState ? await opfs.readText(legacyPath) : undefined;
          if (legacy?.trim()) {
            let part = 1;
            const paths: string[] = [];
            for (const section of redactSecrets(legacy).text.split(/(?=^#{1,3} )/m)) {
              if (!section.trim()) continue;
              const title = section.match(/^#{1,3}\s+([^\n]+)/)?.[1].trim();
              const core = !!title && /^(?:user )?preferences$/i.test(title);
              let remaining = section;
              while (remaining) {
                const body = boundMemoryText(remaining, 4 * 1024, "");
                if (!body) throw new Error("Cannot migrate legacy memory.");
                let path = `legacy/notes-${part++}.md`;
                while (files.has(path)) path = `legacy/notes-${part++}.md`;
                paths.push(path);
                files.set(
                  path,
                  serializeMemoryDocument({
                    metadata: {
                      type: core ? "Preference" : "Reference",
                      title: title ?? `Earlier memory ${part - 1}`,
                      ...(core ? { core: true } : {}),
                      generated: { by: "wingman/migration", at: new Date().toISOString() },
                    },
                    body,
                  }),
                );
                remaining = remaining.slice(body.length);
              }
            }
            state.migration = { paths, attempts: 0 };
          }
          const writable = (path: string) => {
            if (!access.writable) throw new Error("Memory is read-only in this context.");
            if (!path || !path.endsWith(".md") || isMemoryIndex(path))
              throw new Error("Write a Markdown note; generated indexes and imported logs are read-only.");
          };
          const checkRevision = async (paths: string[]) => {
            if (!access.observed) return;
            for (const path of paths) {
              const current = files.get(path);
              if (current !== undefined && !access.observed.has(path))
                throw new Error(`Read ${MEMORY_ROOT}/${path} before changing it.`);
              if (
                access.observed.has(path) &&
                access.observed.get(path) !== (current === undefined ? undefined : await memoryRevision(current))
              )
                throw new Error(`${MEMORY_ROOT}/${path} changed since you read it. Read it again and retry.`);
            }
          };
          const invalidateLearning = async (paths: string[]) => {
            state.epoch++;
            delete state.migration;
            // Pending work is superseded, but its sources remain checkpointed.
            for (const job of state.jobs)
              for (const source of job.sources) state.processed[`${job.chatId}/${source.id}`] = source.hash;
            state.jobs = [];
            for (const path of paths) {
              state.suppressed.push(`path:${path}`);
              const text = files.get(path);
              if (!text) continue;
              const doc = parseMemoryDocument(text);
              state.suppressed.push(`body:${await memoryRevision(doc.body.toLowerCase())}`);
              for (const source of Array.isArray(doc.metadata.sources) ? doc.metadata.sources : []) {
                if (source && typeof source.resource === "string") state.suppressed.push(`source:${source.resource}`);
              }
            }
            state.suppressed = [...new Set(state.suppressed)];
          };
          const writeBatch = async (updates: readonly File[]) => {
            const prepared = new Map<string, string>();
            for (const update of updates) {
              const path = memoryPath(update.path);
              writable(path);
              if (bytes(update.content) > MEMORY_NOTE_MAX_BYTES)
                throw new Error("Memory notes must be at most 8 KiB; split this topic.");
              await checkRevision([path]);
              const previous = files.get(path);
              const before = previous ? parseMemoryDocument(previous) : undefined;
              const doc = parseMemoryDocument(redactSecrets(update.content).text);
              doc.metadata = { ...before?.metadata, ...doc.metadata };
              if (before && doc.body !== before.body) delete doc.metadata.verified;
              doc.metadata.generated = { by: access.actor ?? "wingman/memory", at: new Date().toISOString() };
              if (access.source) {
                const sources = Array.isArray(doc.metadata.sources) ? doc.metadata.sources : [];
                doc.metadata.sources = [
                  ...sources.filter((source) => source.resource !== access.source!.resource),
                  access.source,
                ];
              }
              const content = serializeMemoryDocument(doc);
              if (bytes(content) > MEMORY_NOTE_MAX_BYTES)
                throw new Error("Memory note including metadata exceeds 8 KiB.");
              prepared.set(path, content);
            }
            const next = new Map([...files, ...prepared]);
            if (
              next.size > MEMORY_MAX_NOTES ||
              [...next.values()].reduce((sum, text) => sum + bytes(text), 0) > MEMORY_BUNDLE_MAX_BYTES
            )
              throw new Error("Memory is full. Consolidate or remove older notes before adding more.");
            // All validation precedes the first mutation, including multi-file edits.
            if (access.actor !== "wingman/learning") await invalidateLearning([...prepared.keys()]);
            for (const [path, content] of prepared) files.set(path, content);
            return [];
          };
          const source: WritableFileSource = {
            list: async () =>
              [...files, ...memoryIndexes(files)].map(([path, content]) => ({
                path: `${MEMORY_ROOT}/${path}`,
                size: bytes(content),
                contentType: "text/markdown",
              })),
            read: async (virtual) => {
              const path = memoryPath(virtual);
              const content = files.get(path) ?? memoryIndexes(files).get(path);
              return content === undefined
                ? undefined
                : { path: `${MEMORY_ROOT}/${path}`, content, contentType: "text/markdown" };
            },
            write: (path, content) => writeBatch([{ path, content }]),
            writeBatch,
            remove: async (virtual) => {
              const path = memoryPath(virtual);
              if (!access.writable) throw new Error("Memory is read-only in this context.");
              if (isMemoryIndex(path)) throw new Error("Indexes are generated; delete the notes instead.");
              const targets = [...files.keys()].filter((name) => !path || name === path || name.startsWith(`${path}/`));
              await checkRevision(targets);
              if (targets.length || !path) await invalidateLearning(targets);
              for (const target of targets) files.delete(target);
              return targets.length > 0;
            },
            move: async (from, to) => {
              const oldPath = memoryPath(from);
              const newPath = memoryPath(to);
              if (!access.writable || !oldPath || !newPath || isMemoryIndex(oldPath) || isMemoryIndex(newPath))
                throw new Error("Move a memory note or topic folder, not the mount or an index.");
              if (newPath === oldPath || newPath.startsWith(`${oldPath}/`))
                throw new Error("Choose a destination outside the source folder.");
              const targets = [...files].filter(([path]) => path === oldPath || path.startsWith(`${oldPath}/`));
              if (!targets.length) return false;
              const moved = targets.map(([path, text]) => [newPath + path.slice(oldPath.length), text] as const);
              for (const [path] of moved) {
                writable(path);
                if (files.has(path)) throw new Error("A memory already exists at the destination.");
              }
              await checkRevision([...targets, ...moved].map(([path]) => path));
              await invalidateLearning([...targets, ...moved].map(([path]) => path));
              for (const [path] of targets) files.delete(path);
              for (const [path, content] of moved) files.set(path, content);
              return true;
            },
          };
          const value = await operation({ files, state, source, invalidateLearning });
          if (
            files.size > MEMORY_MAX_NOTES ||
            [...files.values()].reduce((sum, text) => sum + bytes(text), 0) > MEMORY_BUNDLE_MAX_BYTES
          )
            throw new Error("Memory exceeds the 256-note / 1 MiB bundle limit.");
          for (const [path, text] of files) {
            memoryPath(`${MEMORY_ROOT}/${path}`);
            if (bytes(text) > MEMORY_NOTE_MAX_BYTES)
              throw new Error(`Memory note ${path} exceeds 8 KiB; split it before importing.`);
          }
          const next = new Map([...files, ...memoryIndexes(files)]);
          const changes = new Map<string, Blob | undefined>();
          for (const [path, text] of next)
            if (original.get(path) !== text) changes.set(`${this.directory}/${path}`, new Blob([text]));
          for (const path of original.keys()) if (!next.has(path)) changes.set(`${this.directory}/${path}`, undefined);
          changed = changes.size > 0;
          if (changed) state.revision++;
          if (!storedState || changed || JSON.stringify(state) !== initialState)
            changes.set(this.statePath, new Blob([JSON.stringify(state)]));
          changed ||= JSON.stringify(state) !== initialState;
          if (legacy !== undefined) changes.set(legacyPath, undefined);
          if (changes.size) await writeFileChanges(changes);
          return value;
        }),
      ),
    );
    if (changed) publishMemoryChange(this.agentId);
    return result;
  }

  snapshot(): Promise<MemorySnapshot> {
    return this.transaction(async ({ files, state }) => ({ files, state }), { requireEnabled: true });
  }

  async write(path: string, content: string, expected?: string) {
    const observed = new Map([[memoryPath(path), expected]]);
    return this.transaction(async ({ source }) => source.write(path, content), {
      writable: true,
      observed,
      actor: "human:local",
    });
  }

  async remove(path: string, observed?: ReadonlyMap<string, string | undefined>) {
    return this.transaction(async ({ source }) => source.remove(path), {
      writable: true,
      observed,
      actor: "human:local",
    });
  }
}

const managers = new Map<string, MemoryManager>();
export function getMemoryManager(agentId: string): MemoryManager {
  let manager = managers.get(agentId);
  if (!manager) {
    manager = new MemoryManager(agentId);
    managers.set(agentId, manager);
  }
  return manager;
}
