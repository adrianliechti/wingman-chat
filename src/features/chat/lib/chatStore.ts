import type { PersistenceQueue } from "@/shared/lib/persistence";
import { getTextFromContent, type Chat, type ChatEntry } from "@/shared/types/chat";
import { chatEntry, loadChat, loadChatIndex, removeChat, storeChat } from "./chatStorage";

const defaultStorage = {
  index: loadChatIndex,
  load: (id: string) => loadChat(id, false),
  store: storeChat,
  remove: removeChat,
};
type ChatUpdate = (chat: Chat) => Chat;

/** A small index plus conversations loaded on demand, with synchronous edit ownership. */
export class ChatStore {
  private readonly queue: PersistenceQueue;
  private readonly storage: typeof defaultStorage;
  private snapshot: { chats: ChatEntry[]; isLoaded: boolean; revision: number } = {
    chats: [],
    isLoaded: false,
    revision: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly records = new Map<string, Chat>();
  private readonly loading = new Map<string, Promise<Chat>>();
  private readonly edits = new Map<string, ChatUpdate[]>();
  private readonly deleted = new Set<string>();
  private initializing?: Promise<void>;

  constructor(queue: PersistenceQueue, storage = defaultStorage) {
    this.queue = queue;
    this.storage = storage;
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getChat = (id: string): Chat | undefined => this.records.get(id);

  private publish(chats = this.snapshot.chats, isLoaded = this.snapshot.isLoaded): void {
    this.snapshot = { chats, isLoaded, revision: this.snapshot.revision + 1 };
    this.listeners.forEach((listener) => listener());
  }

  initialize = (): Promise<void> => {
    this.initializing ??= this.storage
      .index()
      .then((loaded) => {
        const local = this.snapshot.chats;
        this.publish(
          [...local, ...loaded.filter((item) => !this.deleted.has(item.id) && !local.some((c) => c.id === item.id))],
          true,
        );
      })
      .catch((error) => {
        this.publish(undefined, true);
        this.initializing = undefined;
        throw error;
      });
    return this.initializing;
  };

  private put(chat: Chat): void {
    this.records.set(chat.id, chat);
    const summary = chatEntry(chat);
    const previous = this.snapshot.chats.find((item) => item.id === chat.id);
    const sameEntry = previous && JSON.stringify(previous) === JSON.stringify(summary);
    this.publish(
      sameEntry
        ? undefined
        : previous
          ? this.snapshot.chats.map((item) => (item.id === chat.id ? summary : item))
          : [summary, ...this.snapshot.chats],
    );
  }

  loadChat = (id: string): Promise<Chat> => {
    if (this.deleted.has(id)) return Promise.reject(new Error(`Chat ${id} was deleted`));
    const cached = this.records.get(id);
    if (cached) return Promise.resolve(cached);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const promise = this.storage
      .load(id)
      .then((loaded) => {
        if (this.deleted.has(id)) throw new Error(`Chat ${id} was deleted`);
        if (!loaded) throw new Error(`Chat ${id} could not be found`);
        const chat = (this.edits.get(id) ?? []).reduce((current, edit) => edit(current), loaded);
        this.edits.delete(id);
        this.put(chat);
        return chat;
      })
      .finally(() => {
        this.loading.delete(id);
      });
    this.loading.set(id, promise);
    return promise;
  };

  createChat = async (): Promise<Chat> => {
    const chat: Chat = { id: crypto.randomUUID(), created: new Date(), updated: new Date(), model: null, messages: [] };
    this.put(chat);
    this.queue.schedule(chat.id, () => this.storage.store(chat));
    await this.queue.flushRecord(chat.id);
    if (this.deleted.has(chat.id)) throw new Error(`Chat ${chat.id} was deleted`);
    return this.records.get(chat.id) ?? chat;
  };

  updateChat = (id: string, updater: (chat: Chat) => Partial<Chat>, options?: { preserveDates?: boolean }): void => {
    if (this.deleted.has(id)) return;
    const updated = new Date();
    const edit: ChatUpdate = (chat) => ({
      ...chat,
      ...updater(chat),
      id,
      ...(options?.preserveDates ? {} : { updated }),
    });
    const cached = this.records.get(id);
    if (cached) {
      const next = edit(cached);
      this.put(next);
      this.queue.schedule(id, () => this.storage.store(next));
    } else {
      this.edits.set(id, [...(this.edits.get(id) ?? []), edit]);
      // Register immediately so backup/flush includes edits waiting on a read.
      this.queue.schedule(id, async () => {
        if (this.deleted.has(id)) return;
        await this.loadChat(id);
        if (!this.deleted.has(id)) await this.storage.store(this.records.get(id)!);
      });
    }
  };

  deleteChat = async (id: string): Promise<void> => {
    this.deleted.add(id);
    this.edits.delete(id);
    this.records.delete(id);
    this.publish(this.snapshot.chats.filter((chat) => chat.id !== id));
    this.queue.schedule(id, () => this.storage.remove(id));
    await this.queue.flushRecord(id);
  };

  /** Search manifests only after a query; never read or cache attachment bytes. */
  searchChats = async (query: string, signal: AbortSignal): Promise<Set<string>> => {
    const normalized = query.toLowerCase();
    const matches = new Set<string>();
    for (const summary of this.snapshot.chats) {
      signal.throwIfAborted();
      if (this.deleted.has(summary.id)) continue;
      if (
        summary.title?.toLowerCase().includes(normalized) ||
        summary.customTitle?.toLowerCase().includes(normalized)
      ) {
        matches.add(summary.id);
        continue;
      }
      let chat = this.records.get(summary.id);
      if (!chat) chat = await this.storage.load(summary.id);
      signal.throwIfAborted();
      // An edit/delete may have landed during the read. Prefer current memory.
      chat = this.records.get(summary.id) ?? chat;
      if (
        !this.deleted.has(summary.id) &&
        chat?.messages.some((message) => getTextFromContent(message.content).toLowerCase().includes(normalized))
      )
        matches.add(summary.id);
    }
    return new Set([...matches].filter((id) => !this.deleted.has(id)));
  };
}
