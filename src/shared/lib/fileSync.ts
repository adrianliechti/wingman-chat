/**
 * Whole-OPFS file sync with client-side encryption.
 *
 * Complements ChatSync: chats stay on the fine-grained event-log model,
 * everything else in OPFS (agents, skills, notebooks, repositories,
 * images, profile.json, …) syncs here as encrypted files. Each file is
 * addressed on the server by sha256(path) and stored as one opaque
 * envelope whose plaintext carries the real path + mtime, so the server
 * never learns the tree structure.
 *
 * Change tracking is event-driven: every OPFS write/delete funnels
 * through opfs-core, which notifies this engine; a debounced flush
 * pushes the changes. A full reconcile at startup (and on manual sync)
 * catches whatever happened while the engine wasn't running. Conflicts
 * resolve last-write-wins by file mtime.
 */

import * as api from "./storeClient";
import { type DEK, decryptFile, encryptFile } from "./crypto";
import {
  deleteDirectory,
  deleteFile,
  getRoot,
  type IndexEntry,
  listDirectories,
  listFiles,
  onOpfsMutation,
  readBlob,
  readFileMetadata,
  readJson,
  writeBlob,
  writeJson,
} from "./opfs-core";

/** chats/ is synced by ChatSync; _sync/ is this engine's own state. */
const EXCLUDE_PREFIXES = ["chats/", "_sync/"];
const STATE_FILE = "_sync/files.json";
const FLUSH_DEBOUNCE_MS = 2_000;
/** Files above this are kept local-only (encryption buffers the whole
 *  file in memory, so the cap guards the tab, not the server). Sized to
 *  fit large office documents and notebook media. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

export interface FileSyncActivity {
  syncing: boolean;
  /** Files with local changes not yet confirmed by the server. */
  pendingCount: number;
  lastSyncAt: string | null; // ISO
  lastError: string | null;
}

interface FileHeader {
  path: string;
  mtime: number; // epoch ms of the local file when uploaded
}

interface FileEntry {
  id: string;
  etag: string;
  mtime: number;
}

interface FileSyncState {
  userId: string;
  entries: Record<string, FileEntry>; // path → last synced state
}

function isExcluded(path: string): boolean {
  return EXCLUDE_PREFIXES.some((p) => path.startsWith(p)) || path === "_sync";
}

async function fileIdFor(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isSafePath(path: string): boolean {
  if (!path || path.startsWith("/")) return false;
  const parts = path.split("/");
  return parts.every((p) => p && p !== "." && p !== "..");
}

// Collection indexes ------------------------------------------------------
//
// `{collection}/index.json` files are shared mutable lists — last-write-
// wins would silently drop an entry when two devices create items in
// parallel. They merge by entry id instead (newer `updated` wins), and
// entries whose backing item no longer exists get pruned after a full
// reconcile so deletions still converge.

function isCollectionIndex(path: string): boolean {
  return /^[A-Za-z0-9_-]+\/index\.json$/.test(path);
}

export function mergeIndexEntries(a: IndexEntry[], b: IndexEntry[]): IndexEntry[] {
  const time = (e: IndexEntry) => Date.parse(e.updated ?? "") || 0;
  const byId = new Map<string, IndexEntry>();
  for (const e of [...a, ...b]) {
    if (!e || typeof e.id !== "string") continue;
    const cur = byId.get(e.id);
    if (!cur || time(e) > time(cur)) byId.set(e.id, e);
  }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

function parseIndex(bytes: Uint8Array): IndexEntry[] | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return Array.isArray(parsed) ? (parsed as IndexEntry[]) : null;
  } catch {
    return null;
  }
}

/** Scan the OPFS tree (minus excludes) into path → mtime. */
async function scanLocalTree(): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  async function scan(dirPath: string, handle: FileSystemDirectoryHandle): Promise<void> {
    for await (const [name, entry] of handle.entries()) {
      const path = dirPath ? `${dirPath}/${name}` : name;
      if (isExcluded(path) || isExcluded(`${path}/`)) continue;
      if (entry.kind === "file") {
        const file = await (entry as FileSystemFileHandle).getFile();
        out.set(path, file.lastModified);
      } else {
        await scan(path, entry as FileSystemDirectoryHandle);
      }
    }
  }

  await scan("", await getRoot());
  return out;
}

export class FileSync {
  private state: FileSyncState;
  private readonly userId: string;
  private readonly dek: DEK;

  /** Paths with local changes awaiting push. */
  private dirty = new Set<string>();
  /** Paths currently being written from remote — their mutations are ours. */
  private applying = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private unsubMutations: (() => void) | null = null;
  /** Remote applies that failed during the current fullSync — pruning is
   *  unsafe while any item may simply not have arrived yet. */
  private applyFailures = 0;

  private activity: FileSyncActivity = { syncing: false, pendingCount: 0, lastSyncAt: null, lastError: null };
  private activityListeners = new Set<(a: FileSyncActivity) => void>();

  private constructor(userId: string, dek: DEK, state: FileSyncState) {
    this.userId = userId;
    this.dek = dek;
    this.state = state;
  }

  static async create(opts: { userId: string; dek: DEK }): Promise<FileSync> {
    let state = await readJson<FileSyncState>(STATE_FILE);
    if (state && state.userId !== opts.userId) {
      // Different user on this browser: their files must not bleed into
      // this account. Clear the workspace (chats are handled by ChatSync)
      // and start from the server's copy.
      for (const dir of await listDirectories("")) {
        if (isExcluded(`${dir}/`)) continue;
        await deleteDirectory(dir);
      }
      for (const file of await listFiles("")) {
        await deleteFile(file);
      }
      state = undefined;
    }
    return new FileSync(opts.userId, opts.dek, state ?? { userId: opts.userId, entries: {} });
  }

  /** Watch sync activity (in-flight, pending count, last sync, last error). */
  subscribeActivity(fn: (a: FileSyncActivity) => void): () => void {
    this.activityListeners.add(fn);
    fn(this.activity);
    return () => this.activityListeners.delete(fn);
  }

  private setActivity(patch: Partial<FileSyncActivity>): void {
    this.activity = { ...this.activity, pendingCount: this.dirty.size, ...patch };
    for (const l of this.activityListeners) l(this.activity);
  }

  /** Begin watching OPFS mutations and kick off the initial reconcile. */
  start(): void {
    if (this.unsubMutations) return;
    this.unsubMutations = onOpfsMutation((path, kind) => {
      if (this.applying.has(path)) return;
      if (kind === "delete-dir") {
        // Expand over known paths; files never synced need no tombstone.
        const prefix = path ? `${path}/` : "";
        for (const known of Object.keys(this.state.entries)) {
          if (known.startsWith(prefix)) this.dirty.add(known);
        }
      } else {
        if (isExcluded(path)) return;
        this.dirty.add(path);
      }
      this.setActivity({});
      this.scheduleFlush();
    });
    void this.fullSync().catch((err) => console.warn("fileSync: initial reconcile failed", err));
  }

  stop(): void {
    this.unsubMutations?.();
    this.unsubMutations = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flushDirty(), FLUSH_DEBOUNCE_MS);
  }

  /** Push every dirty path (uploads, deletions, conflict resolution). */
  async flushDirty(): Promise<void> {
    if (this.flushing) {
      this.scheduleFlush();
      return;
    }
    this.flushing = true;
    this.setActivity({ syncing: true });
    try {
      for (const path of Array.from(this.dirty)) {
        this.dirty.delete(path);
        try {
          await this.resolvePath(path);
        } catch (err) {
          this.dirty.add(path);
          this.setActivity({ lastError: err instanceof Error ? err.message : String(err) });
          console.warn(`fileSync: flush failed for ${path}`, err);
          break;
        }
      }
      await this.saveState();
      if (this.dirty.size === 0) {
        this.setActivity({ syncing: false, lastSyncAt: new Date().toISOString(), lastError: null });
      } else {
        this.setActivity({ syncing: false });
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Full reconcile: local tree vs state vs server listing. */
  async fullSync(): Promise<void> {
    this.setActivity({ syncing: true });
    this.applyFailures = 0;
    try {
      const [local, remote] = await Promise.all([scanLocalTree(), api.listFiles()]);
      const remoteById = new Map(remote.map((m) => [m.id, m]));
      const stateById = new Map(Object.entries(this.state.entries).map(([path, e]) => [e.id, { path, entry: e }]));

      // Local changes and deletions → dirty (pushed below).
      for (const [path, mtime] of local) {
        const entry = this.state.entries[path];
        if (!entry || entry.mtime !== mtime) this.dirty.add(path);
      }
      for (const path of Object.keys(this.state.entries)) {
        if (!local.has(path)) this.dirty.add(path);
      }

      // Remote-side changes.
      for (const meta of remote) {
        const known = stateById.get(meta.id);
        if (!known) {
          await this.applyRemote(meta.id);
          continue;
        }
        if (known.entry.etag === meta.etag) continue;

        const localMtime = local.get(known.path);
        if (localMtime !== undefined && localMtime !== known.entry.mtime) {
          // Both sides changed — LWW inside resolvePath (it downloads and
          // compares mtimes on CAS conflict).
          this.dirty.add(known.path);
        } else {
          await this.applyRemote(meta.id);
        }
      }

      // Remote deletions: known file vanished from the server listing.
      for (const [path, entry] of Object.entries(this.state.entries)) {
        if (remoteById.has(entry.id)) continue;
        const localMtime = local.get(path);
        if (localMtime !== undefined && localMtime === entry.mtime) {
          // Unchanged locally → the other device's deletion wins.
          this.applying.add(path);
          try {
            await deleteFile(path);
          } finally {
            this.applying.delete(path);
          }
          delete this.state.entries[path];
          this.dirty.delete(path);
        } else if (localMtime === undefined) {
          // Gone on both sides.
          delete this.state.entries[path];
          this.dirty.delete(path);
        }
        // else: locally modified after our last sync — keep it; the dirty
        // push below re-uploads it.
      }

      await this.saveState();
      await this.flushDirty();

      // Deletions converge here: after everything applied cleanly, index
      // entries whose backing item no longer exists locally are dropped
      // (the write marks the index dirty, so the pruned copy propagates).
      if (this.applyFailures === 0 && this.dirty.size === 0) {
        await this.pruneIndexes();
      }
    } catch (err) {
      this.setActivity({ syncing: false, lastError: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async pruneIndexes(): Promise<void> {
    for (const dir of await listDirectories("")) {
      const path = `${dir}/index.json`;
      if (isExcluded(path) || !isCollectionIndex(path)) continue;

      const entries = await readJson<IndexEntry[]>(path);
      if (!Array.isArray(entries)) continue;

      const subdirs = new Set(await listDirectories(dir));
      const files = new Set(await listFiles(dir));
      const kept = entries.filter((e) => subdirs.has(e.id) || files.has(`${e.id}.json`) || files.has(e.id));

      if (kept.length !== entries.length) {
        await writeJson(path, kept);
      }
    }
  }

  // internals -------------------------------------------------------------

  /** Bring one path in sync: upload, delete remotely, or adopt remote. */
  private async resolvePath(path: string): Promise<void> {
    const entry = this.state.entries[path];
    const meta = await readFileMetadata(path);

    if (!meta) {
      // Locally deleted. Propagate unless the file was never synced.
      if (entry) {
        await api.deleteFile(entry.id);
        delete this.state.entries[path];
      }
      return;
    }

    if (meta.size > MAX_FILE_BYTES) {
      console.warn(`fileSync: skipping ${path} (${meta.size} bytes exceeds sync cap)`);
      return;
    }

    const blob = await readBlob(path);
    if (!blob) return;

    const id = entry?.id ?? (await fileIdFor(path));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header: FileHeader = { path, mtime: meta.lastModified ?? Date.now() };
    const cipher = await encryptFile(this.dek, header, bytes, this.userId, id);

    try {
      const etag = await api.putFile(id, cipher, entry ? { ifMatch: entry.etag } : { ifNoneMatch: "*" });
      this.state.entries[path] = { id, etag, mtime: header.mtime };
    } catch (err) {
      if (!(err instanceof api.ServerError) || err.status !== 412) throw err;

      // CAS conflict: someone else wrote this file. Last write wins.
      const remote = await api.getFile(id);
      if (!remote) {
        // Deleted remotely but changed locally → re-create.
        const etag = await api.putFile(id, cipher, { ifNoneMatch: "*" });
        this.state.entries[path] = { id, etag, mtime: header.mtime };
        return;
      }
      const decrypted = await decryptFile<FileHeader>(this.dek, remote.data, this.userId, id);

      // Collection indexes merge instead of LWW — parallel devices adding
      // entries must not clobber each other's additions.
      if (isCollectionIndex(path)) {
        const localEntries = parseIndex(bytes);
        const remoteEntries = parseIndex(decrypted.bytes);
        if (localEntries && remoteEntries) {
          const merged = new TextEncoder().encode(JSON.stringify(mergeIndexEntries(localEntries, remoteEntries)));
          const mergedCipher = await encryptFile(this.dek, { path, mtime: Date.now() }, merged, this.userId, id);
          try {
            const etag = await api.putFile(id, mergedCipher, { ifMatch: remote.etag });
            await this.writeLocal(path, merged, id, etag);
          } catch (mergeErr) {
            if (!(mergeErr instanceof api.ServerError) || mergeErr.status !== 412) throw mergeErr;
            this.dirty.add(path); // raced again — re-merge on the next flush
          }
          return;
        }
      }

      if (header.mtime > decrypted.header.mtime) {
        const etag = await api.putFile(id, cipher, { ifMatch: remote.etag });
        this.state.entries[path] = { id, etag, mtime: header.mtime };
      } else {
        await this.writeLocal(decrypted.header.path, decrypted.bytes, id, remote.etag);
      }
    }
  }

  /** Download one file by id and adopt it locally. */
  private async applyRemote(id: string): Promise<void> {
    const remote = await api.getFile(id);
    if (!remote) return;

    try {
      const { header, bytes } = await decryptFile<FileHeader>(this.dek, remote.data, this.userId, id);

      // An existing local collection index always merges — adopting the
      // remote copy wholesale would drop entries this device added.
      if (isCollectionIndex(header.path)) {
        const localBlob = await readBlob(header.path);
        const localEntries = localBlob ? parseIndex(new Uint8Array(await localBlob.arrayBuffer())) : null;
        const remoteEntries = parseIndex(bytes);
        if (localEntries && remoteEntries) {
          const merged = mergeIndexEntries(localEntries, remoteEntries);
          if (JSON.stringify(merged) !== JSON.stringify(remoteEntries)) {
            // Local has extra/newer entries: adopt merged and push it back.
            const mergedBytes = new TextEncoder().encode(JSON.stringify(merged));
            await this.writeLocal(header.path, mergedBytes, id, remote.etag);
            this.dirty.add(header.path);
            return;
          }
        }
      }

      // A local file at this path that we never synced (fresh device with
      // an existing workspace) may be newer than the server copy — LWW.
      if (!this.state.entries[header.path]) {
        const local = await readFileMetadata(header.path);
        if (local?.lastModified !== undefined && local.lastModified > header.mtime) {
          this.dirty.add(header.path);
          return;
        }
      }

      await this.writeLocal(header.path, bytes, id, remote.etag);
    } catch (err) {
      this.applyFailures++;
      console.error(`fileSync: failed to decrypt/apply file ${id}`, err);
    }
  }

  private async writeLocal(path: string, bytes: Uint8Array, id: string, etag: string): Promise<void> {
    if (!isSafePath(path) || isExcluded(path)) {
      console.error(`fileSync: refusing to write unsafe path from remote: ${path}`);
      return;
    }

    this.applying.add(path);
    try {
      await writeBlob(path, new Blob([new Uint8Array(bytes)]));
    } finally {
      this.applying.delete(path);
    }

    const meta = await readFileMetadata(path);
    this.state.entries[path] = { id, etag, mtime: meta?.lastModified ?? Date.now() };
    this.dirty.delete(path);
  }

  private async saveState(): Promise<void> {
    await writeJson(STATE_FILE, this.state);
  }
}
