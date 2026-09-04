import { contentToBlob, contentToZipValue } from "@/shared/lib/fileContent";
import * as opfs from "@/shared/lib/opfs";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { downloadBlob, getFileName } from "@/shared/lib/utils";
import type { File, FileEntry, FileSystem } from "@/shared/types/file";
import { artifactChecksum, artifactRevision, type ArtifactMutation } from "@/shared/types/artifact";
import { withArtifactWorkspaceLock } from "./workspaceCoordinator";

export function resolveArtifactFileSystem(
  current: FileSystemManager | null,
  chatId?: string,
): FileSystemManager | null {
  return chatId && current?.chatId !== chatId ? new FileSystemManager(chatId) : current;
}

type FileEventType = "fileCreated" | "fileDeleted" | "fileRenamed" | "fileUpdated";

type FileEventHandler<T extends FileEventType> = T extends "fileCreated"
  ? (path: string) => void
  : T extends "fileDeleted"
    ? (path: string) => void
    : T extends "fileRenamed"
      ? (oldPath: string, newPath: string) => void
      : T extends "fileUpdated"
        ? (path: string) => void
        : never;

export interface OverlayFile {
  content: string;
  contentType?: string;
}

export interface OverlayDelta {
  upserts: Record<string, OverlayFile>;
  deletes: string[];
}

export interface OverlayCommitSummary {
  created: number;
  updated: number;
  deleted: number;
  createdPaths: string[];
  updatedPaths: string[];
  deletedPaths: string[];
  mutations: ArtifactMutation[];
}

export interface OverlaySnapshotOptions {
  deleteMissing?: boolean;
  defaultContentType?: string;
}

export interface ArtifactIngestResult {
  paths: string[];
  pathMap: Record<string, string>;
  mutations: ArtifactMutation[];
}

/** Non-reentrant view used only inside one coordinated workspace transaction. */
export interface ArtifactWorkspaceAccess {
  createFile(path: string, content: string, contentType?: string): Promise<ArtifactMutation | null>;
  deleteFile(path: string): Promise<boolean>;
  deleteFileWithDelta(path: string): Promise<ArtifactMutation[]>;
  renameFile(oldPath: string, newPath: string): Promise<boolean>;
  renameFileWithDelta(oldPath: string, newPath: string): Promise<ArtifactMutation[]>;
  getFile(path: string): Promise<File | undefined>;
  listEntries(): Promise<FileEntry[]>;
  listFiles(): Promise<File[]>;
  getOverlaySnapshot(): Promise<Record<string, OverlayFile>>;
  applyOverlayDelta(delta: OverlayDelta): Promise<OverlayCommitSummary>;
  applyOverlaySnapshot(
    runtimeFiles: Record<string, string | OverlayFile>,
    options?: OverlaySnapshotOptions,
  ): Promise<OverlayCommitSummary>;
}

/** A file cannot replace an existing file, contain one, or sit below one. */
function hasFileTreeConflict(path: string, existingPaths: readonly string[]): boolean {
  return existingPaths.some(
    (existing) => existing === path || existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`),
  );
}

/**
 * FileSystemManager - OPFS-backed file system for artifacts
 *
 * All operations go directly to OPFS. Events are emitted synchronously
 * after OPFS operations complete to notify UI of changes.
 */
class ArtifactWorkspace implements FileSystem, ArtifactWorkspaceAccess {
  private eventHandlers = new Map<FileEventType, Set<(...args: unknown[]) => void>>();
  readonly chatId: string;

  constructor(chatId: string) {
    if (!chatId) {
      throw new Error("FileSystemManager requires a non-empty chatId");
    }
    this.chatId = chatId;
    // Initialize event handler sets
    this.eventHandlers.set("fileCreated", new Set());
    this.eventHandlers.set("fileDeleted", new Set());
    this.eventHandlers.set("fileRenamed", new Set());
    this.eventHandlers.set("fileUpdated", new Set());
  }

  // Event subscription methods
  subscribe<T extends FileEventType>(eventType: T, handler: FileEventHandler<T>): () => void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.add(handler as (...args: unknown[]) => void);
    }

    // Return unsubscribe function
    return () => this.unsubscribe(eventType, handler);
  }

  unsubscribe<T extends FileEventType>(eventType: T, handler: FileEventHandler<T>): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler as (...args: unknown[]) => void);
    }
  }

  private emit(eventType: FileEventType, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in ${eventType} handler:`, error);
        }
      });
    }
  }

  private normalizePath(path: string): string {
    const normalized = normalizeArtifactPath(path);
    if (!normalized) {
      throw new Error("Artifact path is required");
    }

    return normalized;
  }

  /**
   * Create a new file or update an existing file.
   * Writes directly to OPFS, then emits event.
   */
  async createFile(path: string, content: string, contentType?: string): Promise<ArtifactMutation | null> {
    const normalized = this.normalizePath(path);

    // Check if file exists to determine event type
    const existingFile = await opfs.readArtifact(this.chatId, normalized);
    const isUpdate = existingFile !== undefined;

    const resolvedContentType = contentType ?? existingFile?.contentType;
    if (existingFile?.content === content && existingFile.contentType === resolvedContentType) return null;

    if (existingFile) {
      await opfs.archiveArtifactRevision(this.chatId, {
        path: normalized,
        revision: await artifactRevision(existingFile.content, existingFile.contentType),
        content: existingFile.content,
        contentType: existingFile.contentType,
        createdAt: new Date().toISOString(),
      });
    }

    const checksum = await artifactChecksum(content, resolvedContentType);
    await opfs.archiveArtifactRevision(this.chatId, {
      path: normalized,
      revision: `sha256:${checksum}`,
      content,
      contentType: resolvedContentType,
      createdAt: new Date().toISOString(),
    });

    // Publish the live file only after its recoverable revision is durable.
    await opfs.writeArtifact(this.chatId, normalized, content, resolvedContentType);

    // Emit event synchronously after write completes
    if (isUpdate) {
      this.emit("fileUpdated", normalized);
    } else {
      this.emit("fileCreated", normalized);
    }

    return {
      operation: isUpdate ? "update" : "create",
      path: normalized,
      contentType: resolvedContentType,
      size: new TextEncoder().encode(content).byteLength,
      checksum,
      revision: `sha256:${checksum}`,
    };
  }

  async getRevision(path: string): Promise<string | undefined> {
    const file = await opfs.readArtifact(this.chatId, this.normalizePath(path));
    return file ? artifactRevision(file.content, file.contentType) : undefined;
  }

  /** Collision-safe, all-or-nothing attachment promotion into the workspace. */
  async ingestFiles(
    files: Array<{ path: string; content: string; contentType?: string }>,
  ): Promise<ArtifactIngestResult> {
    const taken = new Set(await opfs.listArtifacts(this.chatId));
    const staged = files.map((file) => {
      const requested = this.normalizePath(file.path);
      // Renaming the leaf cannot resolve a file occupying one of its parents.
      // Fail before writing anything instead of looping over suffixes forever.
      if ([...taken].some((existing) => requested.startsWith(`${existing}/`))) {
        throw new Error(`Cannot ingest ${requested}: a parent path is an existing file`);
      }
      let path = requested;
      let counter = 2;
      while (taken.has(path) || hasFileTreeConflict(path, [...taken])) {
        const slash = requested.lastIndexOf("/");
        const dot = requested.lastIndexOf(".");
        const hasExtension = dot > slash;
        path = hasExtension
          ? `${requested.slice(0, dot)}-${counter}${requested.slice(dot)}`
          : `${requested}-${counter}`;
        counter++;
      }
      taken.add(path);
      return { ...file, requested, path };
    });

    const summary = await this.applyOverlayDelta({
      upserts: Object.fromEntries(
        staged.map((file) => [file.path, { content: file.content, contentType: file.contentType }]),
      ),
      deletes: [],
    });

    return {
      paths: staged.map((file) => file.path),
      pathMap: Object.fromEntries(staged.map((file) => [file.requested, file.path])),
      mutations: summary.mutations,
    };
  }

  /**
   * Delete a file or folder. Returns true if something was deleted.
   */
  async deleteFile(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);

    // Check if this is a file
    const file = await opfs.readArtifact(this.chatId, normalized);
    if (file) {
      await opfs.deleteArtifact(this.chatId, normalized);
      this.emit("fileDeleted", normalized);
      return true;
    }

    // Check if this is a folder (has files that start with path + '/')
    const allFiles = await opfs.listArtifacts(this.chatId);
    const affectedFiles = allFiles.filter((f) => f.startsWith(`${normalized}/`));

    if (affectedFiles.length > 0) {
      // Delete the folder and all contents
      await opfs.deleteArtifactFolder(this.chatId, normalized);

      // Emit event for each deleted file
      for (const filePath of affectedFiles) {
        this.emit("fileDeleted", filePath);
      }
      return true;
    }

    return false;
  }

  /** Delete used by agent tools, returning artifact-delta metadata. */
  async deleteFileWithDelta(path: string): Promise<ArtifactMutation[]> {
    const normalized = this.normalizePath(path);
    const direct = await opfs.readArtifact(this.chatId, normalized);
    const paths = direct
      ? [normalized]
      : (await opfs.listArtifacts(this.chatId)).filter((candidate) => candidate.startsWith(`${normalized}/`));
    if (paths.length === 0) return [];

    const snapshots = await Promise.all(
      paths.map(async (candidate) => ({
        path: candidate,
        file: await opfs.readArtifact(this.chatId, candidate),
      })),
    );
    await Promise.all(
      snapshots.flatMap(({ path: candidate, file }) =>
        file
          ? [
              artifactRevision(file.content, file.contentType).then((revision) =>
                opfs.archiveArtifactRevision(this.chatId, {
                  path: candidate,
                  revision,
                  content: file.content,
                  contentType: file.contentType,
                  createdAt: new Date().toISOString(),
                }),
              ),
            ]
          : [],
      ),
    );
    await this.deleteFile(normalized);
    return Promise.all(
      snapshots.map(async ({ path: candidate, file }) => ({
        operation: "delete" as const,
        path: candidate,
        contentType: file?.contentType,
        size: file ? new TextEncoder().encode(file.content).byteLength : undefined,
        checksum: file ? await artifactChecksum(file.content, file.contentType) : undefined,
        revision: file ? await artifactRevision(file.content, file.contentType) : undefined,
      })),
    );
  }

  /**
   * Rename/move a file or folder. Returns true on success.
   */
  async renameFile(oldPath: string, newPath: string): Promise<boolean> {
    const normalizedOld = this.normalizePath(oldPath);
    const normalizedNew = this.normalizePath(newPath);
    if (
      normalizedOld === normalizedNew ||
      normalizedNew.startsWith(`${normalizedOld}/`) ||
      normalizedOld.startsWith(`${normalizedNew}/`)
    )
      return false;

    const allFiles = await opfs.listArtifacts(this.chatId);
    const direct = await opfs.readArtifact(this.chatId, normalizedOld);
    const sources = direct ? [normalizedOld] : allFiles.filter((path) => path.startsWith(`${normalizedOld}/`));
    if (!sources.length) return false;
    const sourceSet = new Set(sources);
    const unaffected = allFiles.filter((path) => !sourceSet.has(path));
    const moves = sources.map((from) => ({ from, to: normalizedNew + from.slice(normalizedOld.length) }));
    if (moves.some(({ to }) => hasFileTreeConflict(to, unaffected))) return false;

    const before = new Map<string, OverlayFile | undefined>();
    for (const { from, to } of moves) {
      const file = await opfs.readArtifact(this.chatId, from);
      if (!file) return false;
      before.set(from, file);
      before.set(to, undefined);
      const revision = await artifactRevision(file.content, file.contentType);
      for (const path of [from, to]) {
        await opfs.archiveArtifactRevision(this.chatId, {
          path,
          revision,
          content: file.content,
          contentType: file.contentType,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Keep both sides recoverable even if a source deletion partially succeeds.
    try {
      for (const { from, to } of moves) {
        const file = before.get(from)!;
        await opfs.writeArtifact(this.chatId, to, file.content, file.contentType);
      }
      for (const { from } of moves) await opfs.deleteArtifact(this.chatId, from);
    } catch (commitError) {
      try {
        await this.restoreTouchedFiles(before);
      } catch (rollbackError) {
        throw new AggregateError([commitError, rollbackError], "Artifact move failed and its rollback was incomplete");
      }
      throw commitError;
    }
    for (const { from, to } of moves) this.emit("fileRenamed", from, to);
    return true;
  }

  /** Move used by agent tools, returning artifact-delta metadata. */
  async renameFileWithDelta(oldPath: string, newPath: string): Promise<ArtifactMutation[]> {
    const normalizedOld = this.normalizePath(oldPath);
    const normalizedNew = this.normalizePath(newPath);
    const direct = await opfs.readArtifact(this.chatId, normalizedOld);
    const sources = direct
      ? [normalizedOld]
      : (await opfs.listArtifacts(this.chatId)).filter((candidate) => candidate.startsWith(`${normalizedOld}/`));
    const snapshots = await Promise.all(
      sources.map(async (from) => ({ from, file: await opfs.readArtifact(this.chatId, from) })),
    );
    if (!(await this.renameFile(normalizedOld, normalizedNew))) return [];
    return Promise.all(
      snapshots.map(async ({ from, file }) => {
        const path = normalizedNew + from.slice(normalizedOld.length);
        const checksum = file ? await artifactChecksum(file.content, file.contentType) : undefined;
        return {
          operation: "move" as const,
          from,
          path,
          contentType: file?.contentType,
          size: file ? new TextEncoder().encode(file.content).byteLength : undefined,
          checksum,
          revision: checksum ? `sha256:${checksum}` : undefined,
        };
      }),
    );
  }

  /**
   * Get a file by path. Returns undefined if not found.
   */
  async getFile(path: string): Promise<File | undefined> {
    const normalized = this.normalizePath(path);
    const data = await opfs.readArtifact(this.chatId, normalized);
    if (!data) {
      return undefined;
    }

    return {
      path: normalized,
      content: data.content,
      contentType: data.contentType,
    };
  }

  /**
   * List file entries without hydrating full content.
   */
  async listEntries(): Promise<FileEntry[]> {
    const entries = await opfs.listArtifactEntries(this.chatId);
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * List all files in the filesystem.
   */
  async listFiles(): Promise<File[]> {
    const entries = await this.listEntries();
    const files: File[] = [];

    for (const { path } of entries) {
      const data = await opfs.readArtifact(this.chatId, path);
      if (data) {
        files.push({
          path,
          content: data.content,
          contentType: data.contentType,
        });
      }
    }

    return files;
  }

  /**
   * Return a normalized overlay snapshot of all files for the current chat.
   */
  async getOverlaySnapshot(): Promise<Record<string, OverlayFile>> {
    const files = await this.listFiles();
    const snapshot: Record<string, OverlayFile> = {};

    for (const file of files) {
      const path = this.normalizePath(file.path);
      snapshot[path] = {
        content: file.content,
        contentType: file.contentType,
      };
    }

    return snapshot;
  }

  /**
   * Apply explicit overlay delta (upserts + deletes) to OPFS.
   */
  async applyOverlayDelta(delta: OverlayDelta): Promise<OverlayCommitSummary> {
    // Normalize the complete plan before touching storage. A malformed late
    // path must not leave earlier upserts committed.
    const normalizedDelta: OverlayDelta = {
      upserts: Object.fromEntries(
        Object.entries(delta.upserts).map(([path, file]) => [this.normalizePath(path), file]),
      ),
      deletes: delta.deletes.map((path) => this.normalizePath(path)),
    };
    // Snapshot only paths this delta can touch, including descendants of folder deletes.
    const touched = new Set(Object.keys(normalizedDelta.upserts));
    if (normalizedDelta.deletes.length) {
      const entries = await this.listEntries();
      for (const path of normalizedDelta.deletes) {
        touched.add(path);
        for (const entry of entries) {
          if (entry.path.startsWith(`${path}/`)) touched.add(entry.path);
        }
      }
    }
    const before = new Map<string, OverlayFile | undefined>();
    for (const path of touched) before.set(path, await opfs.readArtifact(this.chatId, path));

    try {
      return await this.applyOverlayDeltaUnsafe(normalizedDelta);
    } catch (commitError) {
      try {
        await this.restoreTouchedFiles(before);
      } catch (rollbackError) {
        throw new AggregateError(
          [commitError, rollbackError],
          "Artifact commit failed and its rollback was incomplete",
        );
      }
      throw commitError;
    }
  }

  private async applyOverlayDeltaUnsafe(delta: OverlayDelta): Promise<OverlayCommitSummary> {
    const createdPaths: string[] = [];
    const updatedPaths: string[] = [];
    const deletedPaths: string[] = [];
    const mutations: ArtifactMutation[] = [];

    for (const [rawPath, file] of Object.entries(delta.upserts)) {
      const path = this.normalizePath(rawPath);
      const existing = await opfs.readArtifact(this.chatId, path);

      if (!existing) {
        const mutation = await this.createFile(path, file.content, file.contentType);
        createdPaths.push(path);
        if (mutation) mutations.push(mutation);
      } else if (
        existing.content !== file.content ||
        existing.contentType !== (file.contentType ?? existing.contentType)
      ) {
        const mutation = await this.createFile(path, file.content, file.contentType ?? existing.contentType);
        updatedPaths.push(path);
        if (mutation) mutations.push(mutation);
      }
    }

    for (const rawPath of delta.deletes) {
      // deleteFile normalizes internally
      const deleteMutations = await this.deleteFileWithDelta(rawPath);
      if (deleteMutations.length > 0) {
        deletedPaths.push(this.normalizePath(rawPath));
        mutations.push(...deleteMutations);
      }
    }

    return {
      created: createdPaths.length,
      updated: updatedPaths.length,
      deleted: deletedPaths.length,
      createdPaths,
      updatedPaths,
      deletedPaths,
      mutations,
    };
  }

  /** Restore only the live workspace. Revision archives are immutable history
   * and may safely retain revisions written by a failed transaction. */
  private async restoreTouchedFiles(before: Map<string, OverlayFile | undefined>): Promise<void> {
    const failures: unknown[] = [];
    for (const [path, file] of before) {
      try {
        const currentFile = await opfs.readArtifact(this.chatId, path);
        if (!file) {
          if (currentFile) {
            await opfs.deleteArtifact(this.chatId, path);
            this.emit("fileDeleted", path);
          }
          continue;
        }
        if (currentFile?.content === file.content && currentFile.contentType === file.contentType) continue;
        await opfs.writeArtifact(this.chatId, path, file.content, file.contentType);
        this.emit(currentFile ? "fileUpdated" : "fileCreated", path);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Could not restore every touched artifact");
  }

  /**
   * Apply a full runtime snapshot to OPFS as overlay commit.
   * When deleteMissing=true, paths absent in snapshot are removed.
   */
  async applyOverlaySnapshot(
    runtimeFiles: Record<string, string | OverlayFile>,
    options: OverlaySnapshotOptions = {},
  ): Promise<OverlayCommitSummary> {
    const { deleteMissing = false, defaultContentType } = options;
    const normalizedRuntimePaths = new Set<string>();
    const upserts: Record<string, OverlayFile> = {};

    for (const [rawPath, value] of Object.entries(runtimeFiles)) {
      const path = this.normalizePath(rawPath);
      normalizedRuntimePaths.add(path);

      if (typeof value === "string") {
        upserts[path] = { content: value, contentType: defaultContentType };
      } else {
        upserts[path] = {
          content: value.content,
          contentType: value.contentType ?? defaultContentType,
        };
      }
    }

    const deletes: string[] = [];
    if (deleteMissing) {
      const existingEntries = await this.listEntries();
      for (const entry of existingEntries) {
        const existingPath = this.normalizePath(entry.path);
        if (!normalizedRuntimePaths.has(existingPath)) {
          deletes.push(existingPath);
        }
      }
    }

    return this.applyOverlayDelta({ upserts, deletes });
  }

  /**
   * Check if a file exists at the given path.
   */
  async fileExists(path: string): Promise<boolean> {
    const data = await opfs.readArtifact(this.chatId, this.normalizePath(path));
    return data !== undefined;
  }

  /**
   * Get the number of files in the filesystem.
   */
  async getFileCount(): Promise<number> {
    return (await this.listEntries()).length;
  }

  /**
   * Download all files as a zip archive.
   */
  async downloadAsZip(filename: string = "filesystem.zip"): Promise<void> {
    const files = await this.listFiles();
    if (files.length === 0) {
      throw new Error("No files to download");
    }

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const file of files) {
      // Remove leading slash if present for cleaner zip structure
      const cleanPath = file.path.startsWith("/") ? file.path.substring(1) : file.path;
      zip.file(cleanPath, contentToZipValue(file));
    }

    try {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, filename);
    } catch (error) {
      throw new Error(`Failed to create zip file: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Download a single file by path.
   */
  async downloadFile(path: string): Promise<void> {
    const file = await this.getFile(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    const blob = contentToBlob(file.content, file.contentType);
    downloadBlob(blob, getFileName(file.path));
  }
}
/** Coordinates UI, tools and interpreter transactions for this chat across instances/tabs. */
export class FileSystemManager implements FileSystem {
  private readonly workspace: ArtifactWorkspace;
  readonly chatId: string;

  constructor(chatId: string) {
    this.workspace = new ArtifactWorkspace(chatId);
    this.chatId = chatId;
  }

  /** Use only the supplied access inside the callback; reacquiring this manager would deadlock. */
  withExclusiveAccess<T>(run: (access: ArtifactWorkspaceAccess) => Promise<T>): Promise<T> {
    return this.coordinate(run);
  }

  private coordinate<T>(run: (access: ArtifactWorkspace) => Promise<T>): Promise<T> {
    return withArtifactWorkspaceLock(this.chatId, () => run(this.workspace));
  }

  subscribe<T extends FileEventType>(eventType: T, handler: FileEventHandler<T>): () => void {
    return this.workspace.subscribe(eventType, handler);
  }

  unsubscribe<T extends FileEventType>(eventType: T, handler: FileEventHandler<T>): void {
    this.workspace.unsubscribe(eventType, handler);
  }

  createFile(path: string, content: string, contentType?: string) {
    return this.coordinate(
      async (access) =>
        (await access.applyOverlayDelta({ upserts: { [path]: { content, contentType } }, deletes: [] })).mutations[0] ??
        null,
    );
  }

  getRevision(path: string) {
    return this.coordinate((access) => access.getRevision(path));
  }

  ingestFiles(files: Array<{ path: string; content: string; contentType?: string }>) {
    return this.coordinate((access) => access.ingestFiles(files));
  }

  deleteFile(path: string) {
    return this.coordinate(
      async (access) => (await access.applyOverlayDelta({ upserts: {}, deletes: [path] })).deleted > 0,
    );
  }

  deleteFileWithDelta(path: string) {
    return this.coordinate(
      async (access) => (await access.applyOverlayDelta({ upserts: {}, deletes: [path] })).mutations,
    );
  }

  renameFile(oldPath: string, newPath: string) {
    return this.coordinate((access) => access.renameFile(oldPath, newPath));
  }

  renameFileWithDelta(oldPath: string, newPath: string) {
    return this.coordinate((access) => access.renameFileWithDelta(oldPath, newPath));
  }

  getFile(path: string) {
    return this.coordinate((access) => access.getFile(path));
  }

  listEntries() {
    return this.coordinate((access) => access.listEntries());
  }

  listFiles() {
    return this.coordinate((access) => access.listFiles());
  }

  getOverlaySnapshot() {
    return this.coordinate((access) => access.getOverlaySnapshot());
  }

  applyOverlayDelta(delta: OverlayDelta) {
    return this.coordinate((access) => access.applyOverlayDelta(delta));
  }

  applyOverlaySnapshot(files: Record<string, string | OverlayFile>, options?: OverlaySnapshotOptions) {
    return this.coordinate((access) => access.applyOverlaySnapshot(files, options));
  }

  fileExists(path: string) {
    return this.coordinate((access) => access.fileExists(path));
  }

  getFileCount() {
    return this.coordinate((access) => access.getFileCount());
  }

  downloadAsZip(filename = "filesystem.zip") {
    return this.coordinate((access) => access.downloadAsZip(filename));
  }

  downloadFile(path: string) {
    return this.coordinate((access) => access.downloadFile(path));
  }
}
