import { SyncProgressTracker, type SyncProgress } from "./syncProgress";
import { isBackupSessionCurrent, withBackupStorage } from "./backupLifecycle";
/**
 * Whole-OPFS file sync with client-side encryption.
 *
 * Complements ChatSync: chats stay on the fine-grained event-log model,
 * everything else in OPFS (agents, skills, notebooks, repositories,
 * images, profile.json, …) syncs here as encrypted files. Each file is
 * addressed on the server by sha256(path) and stored as one opaque
 * envelope whose plaintext carries the real path + mtime, so the server
 * can test guesses for common paths against the unkeyed hashes.
 *
 * Change tracking is event-driven: every OPFS write/delete funnels
 * through opfs-core, which notifies this engine; a debounced flush
 * pushes the changes. A full reconcile at startup (and on manual sync)
 * catches whatever happened while the engine wasn't running. Conflicts
 * resolve last-write-wins by file mtime.
 */

import { areFileBackupsPaused, requireFileBackupReady, BackupPausedError } from "./chatBackupActivity";
import * as api from "./storeClient";
import { type StoreKey, canRestore, decryptFile, encryptFile } from "./crypto";
import {
  getRoot,
  type IndexEntry,
  onOpfsMutation,
  readBlob,
  readFileMetadata,
  readJson,
  replaceFileIfUnchanged,
  writeJson,
} from "./opfs-core";

/** Chat manifests and blobs belong to ChatSync; revision history stays local. */
const CHAT_FILE_PREFIX = /^chats\/[^/]+\/(artifacts|artifact-state)\//;
const STATE_FILE = "_sync/files.json";
const FLUSH_DEBOUNCE_MS = 2_000;
/** Files above this are kept local-only (encryption buffers the whole
 *  file in memory, so the cap guards the tab, not the server). Sized to
 *  fit large office documents and notebook media. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

export interface FileSyncActivity {
  progress: SyncProgress[];
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
  if (path === "_sync" || path.startsWith("_sync/")) return true;
  if (path === "chats" || path.startsWith("chats/")) return !CHAT_FILE_PREFIX.test(path);
  return false;
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
// deletion of backing files propagates independently.

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
      if (entry.kind === "file") {
        if (isExcluded(path)) continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        out.set(path, file.lastModified);
      } else {
        // Traverse chat ancestors to reach workspace files without scanning logs/blobs.
        const chatAncestor = path === "chats" || /^chats\/[^/]+$/.test(path);
        if (!chatAncestor && isExcluded(`${path}/`)) continue;
        await scan(path, entry as FileSystemDirectoryHandle);
      }
    }
  }

  await scan("", await getRoot());
  return out;
}

class RestoreRequiredError extends Error {}
class FileTooLargeError extends Error {}

export class FileSync {
  private state: FileSyncState;
  private readonly userId: string;
  private dek: StoreKey;

  /** Paths with local changes awaiting push. */
  private dirty = new Set<string>();
  private mutationVersion = new Map<string, number>();
  private versionForPath(path: string, versions = this.mutationVersion): number {
    const parts = path.split("/");
    let version = 0;
    for (let i = 1; i <= parts.length; i++) version += versions.get(parts.slice(0, i).join("/")) ?? 0;
    return version;
  }
  /** Paths currently being written from remote — their mutations are ours. */
  private applying = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private operation: Promise<void> = Promise.resolve();
  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(() => {});
    return result;
  }
  private unsubMutations: (() => void) | null = null;
  /** Remote applies that failed during the current fullSync. */
  private applyFailures = 0;

  private activity: FileSyncActivity = {
    syncing: false,
    pendingCount: 0,
    lastSyncAt: null,
    lastError: null,
    progress: [],
  };
  private progress = new SyncProgressTracker(() => this.setActivity({}));
  private activityListeners = new Set<(a: FileSyncActivity) => void>();

  private constructor(userId: string, dek: StoreKey, state: FileSyncState) {
    this.userId = userId;
    this.dek = dek;
    this.state = state;
  }

  static async create(opts: { userId: string; dek: StoreKey }): Promise<FileSync> {
    const state = await readJson<FileSyncState>(STATE_FILE);
    if (state && state.userId !== opts.userId) {
      throw new Error(
        "This browser contains another account's local workspace. Sign back in to export it before clearing local data.",
      );
    }
    return new FileSync(opts.userId, opts.dek, state ?? { userId: opts.userId, entries: {} });
  }

  setKey(dek: StoreKey): void {
    this.dek = dek;
  }

  /** Watch sync activity (in-flight, pending count, last sync, last error). */
  subscribeActivity(fn: (a: FileSyncActivity) => void): () => void {
    this.activityListeners.add(fn);
    fn(this.activity);
    return () => this.activityListeners.delete(fn);
  }

  private setActivity(patch: Partial<Omit<FileSyncActivity, "syncing" | "progress">>): void {
    const progress = this.progress.snapshot;
    this.activity = {
      ...this.activity,
      pendingCount: this.dirty.size,
      ...patch,
      progress,
      syncing: progress.length > 0,
    };
    for (const l of this.activityListeners) l(this.activity);
  }

  /** Begin watching OPFS mutations and kick off the initial reconcile. */
  start(): void {
    if (this.unsubMutations) return;
    this.unsubMutations = onOpfsMutation((path, kind) => {
      if (this.applying.has(path)) return;
      if (kind === "delete-dir") {
        this.mutationVersion.set(path, (this.mutationVersion.get(path) ?? 0) + 1);
        // Expand over known paths; files never synced need no tombstone.
        const prefix = path ? `${path}/` : "";
        for (const known of new Set([...Object.keys(this.state.entries), ...this.dirty])) {
          if (known.startsWith(prefix)) {
            this.dirty.add(known);
          }
        }
      } else {
        if (isExcluded(path)) return;
        this.mutationVersion.set(path, (this.mutationVersion.get(path) ?? 0) + 1);
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
  flushDirty(): Promise<void> {
    return this.serialize(() =>
      withBackupStorage(async () => {
        if (isBackupSessionCurrent()) await this.flushDirtyUnlocked();
      }),
    );
  }

  private async flushDirtyUnlocked(): Promise<void> {
    if (areFileBackupsPaused()) return;
    const paths = Array.from(this.dirty);
    const progress = this.progress.begin("backup", paths.length);
    try {
      for (const path of paths) {
        if (areFileBackupsPaused()) break;
        this.dirty.delete(path);
        try {
          await this.resolvePath(path);
          progress.advance();
        } catch (err) {
          this.dirty.add(path);
          if (err instanceof BackupPausedError) break;
          this.setActivity({ lastError: err instanceof Error ? err.message : String(err) });
          console.warn(`fileSync: flush failed for ${path}`, err);
          if (!(err instanceof RestoreRequiredError) && !(err instanceof FileTooLargeError)) break;
        }
      }
      await this.saveState();
      if (this.dirty.size === 0) {
        this.setActivity({ lastSyncAt: new Date().toISOString(), lastError: null });
      } else {
        this.setActivity({});
      }
    } finally {
      progress.finish();
    }
  }

  /** Full reconcile: local tree vs state vs server listing. */
  private fullSyncInFlight: Promise<void> | null = null;

  async fullSync(): Promise<void> {
    if (this.fullSyncInFlight) return this.fullSyncInFlight;
    this.fullSyncInFlight = this.serialize(() =>
      withBackupStorage(async () => {
        if (isBackupSessionCurrent()) await this.reconcile();
      }),
    ).finally(() => {
      this.fullSyncInFlight = null;
    });
    return this.fullSyncInFlight;
  }

  async restore(): Promise<void> {
    await this.fullSyncInFlight;
    await this.fullSync();
  }

  private async reconcile(): Promise<void> {
    if (!canRestore(this.dek) || areFileBackupsPaused()) {
      const preparing = this.progress.begin("backup");
      try {
        const local = await scanLocalTree();
        for (const [path, mtime] of local) {
          if (this.state.entries[path]?.mtime !== mtime) this.dirty.add(path);
        }
        for (const path of Object.keys(this.state.entries)) {
          if (!local.has(path)) this.dirty.add(path);
        }
      } finally {
        preparing.finish();
      }
      await this.flushDirtyUnlocked();
      return;
    }
    const progress = this.progress.begin("restore");
    this.applyFailures = 0;
    try {
      const versions = new Map(this.mutationVersion);
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

      // Count only remote files that need downloading or reconciliation.
      const changed = remote.filter((meta) => stateById.get(meta.id)?.entry.etag !== meta.etag);
      progress.setTotal(changed.length);
      for (const meta of changed) {
        const failuresBefore = this.applyFailures;
        const known = stateById.get(meta.id);
        if (!known) {
          await this.applyRemote(meta.id, local, versions);
        } else if (!local.has(known.path) || local.get(known.path) !== known.entry.mtime) {
          // Both sides changed — LWW inside resolvePath (it downloads and
          // compares mtimes on CAS conflict).
          this.dirty.add(known.path);
        } else {
          await this.applyRemote(meta.id, local, versions);
        }
        if (this.applyFailures === failuresBefore) progress.advance();
      }

      // Remote deletions: known file vanished from the server listing.
      for (const [path, entry] of Object.entries(this.state.entries)) {
        if (remoteById.has(entry.id)) continue;
        const localMtime = local.get(path);
        if (localMtime !== undefined && localMtime === entry.mtime) {
          // Unchanged locally → the other device's deletion wins.
          const version = this.versionForPath(path, versions);
          if (!(await this.replaceLocal(path, localMtime, undefined, version))) {
            this.dirty.add(path);
            continue;
          }
          delete this.state.entries[path];
          if (this.versionForPath(path) === version) this.dirty.delete(path);
          else this.dirty.add(path);
        } else if (localMtime === undefined) {
          // Gone on both sides.
          delete this.state.entries[path];
          const untouched = this.versionForPath(path) === this.versionForPath(path, versions);
          if (untouched && !(await readFileMetadata(path))) this.dirty.delete(path);
          else this.dirty.add(path);
        }
        // else: locally modified after our last sync — keep it; the dirty
        // push below re-uploads it.
      }

      await this.saveState();
      progress.finish(); // the upload below reports its own progress
      await this.flushDirtyUnlocked();

      if (this.applyFailures > 0) {
        throw new Error(
          `${this.applyFailures} backup ${this.applyFailures === 1 ? "file" : "files"} could not be restored. Retry after checking the backup.`,
        );
      }
    } catch (err) {
      this.setActivity({ lastError: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      progress.finish();
    }
  }

  // internals -------------------------------------------------------------

  /** Bring one path in sync: upload, delete remotely, or adopt remote. */
  private async resolvePath(path: string): Promise<void> {
    const version = this.versionForPath(path);
    const entry = this.state.entries[path];
    const meta = await readFileMetadata(path);

    if (!meta) {
      // Locally deleted. Propagate unless the file was never synced.
      if (entry) {
        if (!canRestore(this.dek)) throw new RestoreRequiredError("Unlock restore before deleting a server backup.");
        requireFileBackupReady();
        try {
          await api.deleteFile(entry.id, { ifMatch: entry.etag });
        } catch (err) {
          // Another device changed the file after our last sync. Its edit beats
          // this deletion and comes back with the next restore.
          if (!(err instanceof api.ServerError) || err.status !== 412) throw err;
        }
        delete this.state.entries[path];
      }
      return;
    }

    const blob = await readBlob(path);
    if (!blob) return;
    if (Math.max(meta.size, blob.size) > MAX_FILE_BYTES) {
      throw new FileTooLargeError(`${path} exceeds the 256 MiB backup limit.`);
    }

    const id = entry?.id ?? (await fileIdFor(path));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header: FileHeader = { path, mtime: meta.lastModified ?? Date.now() };
    const cipher = await encryptFile(this.dek, header, bytes, this.userId, id);

    try {
      requireFileBackupReady();
      const etag = await api.putFile(id, cipher, entry ? { ifMatch: entry.etag } : { ifNoneMatch: "*" });
      this.state.entries[path] = { id, etag, mtime: header.mtime };
    } catch (err) {
      if (!(err instanceof api.ServerError) || err.status !== 412) throw err;

      if (!canRestore(this.dek))
        throw new RestoreRequiredError(
          "Another device changed this file. Unlock restore to reconcile before uploading.",
        );

      // CAS conflict: someone else wrote this file. Last write wins.
      requireFileBackupReady();
      const remote = await api.getFile(id);
      if (!remote) {
        // Deleted remotely but changed locally → re-create.
        requireFileBackupReady();
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
            requireFileBackupReady();
            const etag = await api.putFile(id, mergedCipher, { ifMatch: remote.etag });
            await this.writeLocal(path, merged, id, etag, meta.lastModified, version);
          } catch (mergeErr) {
            if (!(mergeErr instanceof api.ServerError) || mergeErr.status !== 412) throw mergeErr;
            this.dirty.add(path); // raced again — re-merge on the next flush
          }
          return;
        }
      }

      if (header.mtime > decrypted.header.mtime) {
        requireFileBackupReady();
        const etag = await api.putFile(id, cipher, { ifMatch: remote.etag });
        this.state.entries[path] = { id, etag, mtime: header.mtime };
      } else {
        await this.writeLocal(decrypted.header.path, decrypted.bytes, id, remote.etag, meta.lastModified, version);
      }
    }
  }

  /** Download one file by id and adopt it locally. */
  private async applyRemote(id: string, local: Map<string, number>, versions: Map<string, number>): Promise<void> {
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
            await this.writeLocal(
              header.path,
              mergedBytes,
              id,
              remote.etag,
              local.get(header.path),
              this.versionForPath(header.path, versions),
            );
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

      await this.writeLocal(
        header.path,
        bytes,
        id,
        remote.etag,
        local.get(header.path),
        this.versionForPath(header.path, versions),
      );
    } catch (err) {
      this.applyFailures++;
      console.error(`fileSync: failed to decrypt/apply file ${id}`, err);
    }
  }

  private async replaceLocal(path: string, mtime: number | undefined, blob?: Blob, version?: number): Promise<boolean> {
    return replaceFileIfUnchanged(path, mtime, {
      blob,
      notify: (emit) => {
        this.applying.add(path);
        try {
          emit();
        } finally {
          this.applying.delete(path);
        }
      },
      unchanged: () => this.versionForPath(path) === (version ?? 0),
    });
  }

  private async writeLocal(
    path: string,
    bytes: Uint8Array,
    id: string,
    etag: string,
    expectedMtime: number | undefined,
    version: number | undefined,
  ): Promise<void> {
    if (!isSafePath(path) || id !== (await fileIdFor(path))) {
      throw new Error(`Refusing to restore a backup file with an unsafe or mismatched path: ${path}`);
    }
    if (isExcluded(path)) return;

    if (!(await this.replaceLocal(path, expectedMtime, new Blob([new Uint8Array(bytes)]), version))) {
      this.dirty.add(path);
      return;
    }

    const meta = await readFileMetadata(path);
    const changed = this.versionForPath(path) !== (version ?? 0);
    this.state.entries[path] = { id, etag, mtime: changed ? -1 : (meta?.lastModified ?? Date.now()) };
    if (changed) this.dirty.add(path);
    else this.dirty.delete(path);
  }

  private async saveState(): Promise<void> {
    await writeJson(STATE_FILE, this.state);
  }
}
