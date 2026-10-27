import type { ContentPart } from "@tanstack/ai";
import {
  deleteDirectory,
  listFiles,
  readBlob,
  readJson,
  writeBlob,
  writeJson,
  deleteFile,
} from "@/shared/lib/opfs-core";
import { type PersistenceQueue, withPersistenceLock } from "@/shared/lib/persistence";

export interface ComposerDraft {
  content: string;
  attachments: ContentPart[];
  pendingFiles: File[];
  pendingImages: (File | null)[];
}
export const EMPTY_DRAFT: ComposerDraft = { content: "", attachments: [], pendingFiles: [], pendingImages: [] };
interface DraftSnapshot {
  draft: ComposerDraft;
  loaded: boolean;
  error?: string;
  sending?: boolean;
}
const UNLOADED: DraftSnapshot = { draft: EMPTY_DRAFT, loaded: false };
interface StoredFile {
  id: string;
  name: string;
  type: string;
  lastModified: number;
}
interface StoredDraft {
  content: string;
  attachments: ContentPart[];
  pendingFiles: StoredFile[];
  pendingImages: (StoredFile | null)[];
}
export const composerDraftKey = (chatId: string | null, projectId?: string | null) =>
  chatId ? `chat-${chatId}` : `new-${projectId ?? "chat"}`;
const folder = (key: string) => `drafts/${encodeURIComponent(key)}`;
const fileIds = new WeakMap<File, string>();

export async function loadComposerDraft(key: string): Promise<ComposerDraft> {
  return withPersistenceLock("collection:drafts", async () => {
    const saved = await readJson<StoredDraft>(`${folder(key)}/draft.json`);
    if (!saved) return EMPTY_DRAFT;
    if (
      typeof saved.content !== "string" ||
      !Array.isArray(saved.attachments) ||
      !Array.isArray(saved.pendingFiles) ||
      !Array.isArray(saved.pendingImages)
    )
      throw new Error("Invalid saved draft");
    const read = async (entry: StoredFile): Promise<File> => {
      if (!/^[a-zA-Z0-9-]+$/.test(entry.id)) throw new Error("Invalid draft attachment");
      const blob = await readBlob(`${folder(key)}/files/${entry.id}`);
      if (!blob) throw new Error(`Draft attachment is missing: ${entry.name}`);
      const file = new File([blob], entry.name, { type: entry.type, lastModified: entry.lastModified });
      fileIds.set(file, entry.id);
      return file;
    };
    return {
      content: saved.content,
      attachments: saved.attachments,
      pendingFiles: await Promise.all(saved.pendingFiles.map(read)),
      pendingImages: await Promise.all(saved.pendingImages.map((f) => (f ? read(f) : Promise.resolve(null)))),
    };
  });
}

export async function saveComposerDraft(key: string, draft: ComposerDraft): Promise<void> {
  return withPersistenceLock("collection:drafts", async () => {
    if (!draft.content && !draft.attachments.length && !draft.pendingFiles.length) {
      await deleteDirectory(folder(key));
      return;
    }
    const existing = new Set(await listFiles(`${folder(key)}/files`));
    const retained = new Set<string>();
    const save = async (file: File): Promise<StoredFile> => {
      const id = fileIds.get(file) ?? crypto.randomUUID();
      fileIds.set(file, id);
      retained.add(id);
      if (!existing.has(id)) await writeBlob(`${folder(key)}/files/${id}`, file);
      return { id, name: file.name, type: file.type, lastModified: file.lastModified };
    };
    // Settle every file write before releasing the collection lock on failure.
    const results = await Promise.allSettled(
      [...draft.pendingFiles, ...draft.pendingImages].map((file) => (file ? save(file) : Promise.resolve(null))),
    );
    const files = results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    await writeJson(`${folder(key)}/draft.json`, {
      content: draft.content,
      attachments: draft.attachments,
      pendingFiles: files.slice(0, draft.pendingFiles.length),
      pendingImages: files.slice(draft.pendingFiles.length),
    });
    for (const id of existing) if (!retained.has(id)) await deleteFile(`${folder(key)}/files/${id}`);
  });
}

const storage = { load: loadComposerDraft, save: saveComposerDraft };

/** Each async operation owns its original composer, even after navigation. */
export class ComposerDraftStore {
  private readonly states = new Map<string, DraftSnapshot>();
  private readonly loads = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private readonly removed = new Set<string>();
  private readonly queue: PersistenceQueue;
  private readonly storage: typeof storage;
  constructor(queue: PersistenceQueue, persistence = storage) {
    this.queue = queue;
    this.storage = persistence;
  }
  get = (key: string): DraftSnapshot => this.states.get(key) ?? UNLOADED;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(key: string, state: DraftSnapshot) {
    this.states.set(key, state);
    this.listeners.forEach((listener) => listener());
  }
  load = (key: string): Promise<void> => {
    if (this.get(key).loaded) return Promise.resolve();
    const pending = this.loads.get(key);
    if (pending) return pending;
    const promise = this.storage
      .load(key)
      .then((draft) => {
        if (!this.get(key).loaded) this.publish(key, { loaded: true, draft });
      })
      .catch((error) => {
        if (!this.get(key).loaded) this.publish(key, { loaded: false, draft: EMPTY_DRAFT, error: String(error) });
        throw error;
      })
      .finally(() => this.loads.delete(key));
    this.loads.set(key, promise);
    return promise;
  };
  update = (key: string, edit: (draft: ComposerDraft) => ComposerDraft) => {
    if (this.removed.has(key)) return;
    const state = this.get(key);
    if (!state.loaded) throw new Error("Draft is still loading");
    const draft = edit(state.draft);
    this.publish(key, { loaded: true, draft, sending: state.sending });
    this.queue.schedule(key, () => this.storage.save(key, draft));
  };
  clearIfUnchanged(key: string, draft: ComposerDraft) {
    if (this.get(key).draft === draft) {
      this.update(key, () => EMPTY_DRAFT);
      this.setSending(key, false);
    }
  }
  setSending(key: string, sending: boolean) {
    this.publish(key, { ...this.get(key), sending });
  }
  finishSending(draft: ComposerDraft) {
    for (const [key, state] of this.states) if (state.sending && state.draft === draft) this.setSending(key, false);
  }
  async transfer(from: string, to: string) {
    await this.load(from);
    const draft = this.get(from).draft;
    this.publish(to, { loaded: true, draft, sending: this.get(from).sending });
    this.queue.schedule(to, () => this.storage.save(to, draft));
    // Keep the source durable until the destination has been committed.
    await this.queue.flushRecord(to);
    this.clearIfUnchanged(from, draft);
  }
  remove(key: string) {
    this.removed.add(key);
    this.publish(key, { loaded: true, draft: EMPTY_DRAFT });
    this.queue.schedule(key, () => this.storage.save(key, EMPTY_DRAFT));
  }
}
