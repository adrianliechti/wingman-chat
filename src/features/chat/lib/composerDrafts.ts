import type { ContentPart } from "@tanstack/ai";

export interface ComposerDraft {
  content: string;
  skills?: string[];
  attachments: ContentPart[];
  pendingFiles: File[];
  pendingImages: (File | null)[];
}
export const EMPTY_DRAFT: ComposerDraft = { content: "", attachments: [], pendingFiles: [], pendingImages: [] };
interface DraftSnapshot {
  draft: ComposerDraft;
  sending?: boolean;
  sendingDraft?: ComposerDraft;
}
const EMPTY: DraftSnapshot = { draft: EMPTY_DRAFT };
export const composerDraftKey = (chatId: string | null, projectId?: string | null) =>
  chatId ? `chat-${chatId}` : `new-${projectId ?? "chat"}`;

/** Each async operation owns its original composer, even after navigation. */
export class ComposerDraftStore {
  private readonly states = new Map<string, DraftSnapshot>();
  private readonly listeners = new Set<() => void>();
  private readonly removed = new Set<string>();
  get = (key: string): DraftSnapshot => this.states.get(key) ?? EMPTY;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(key: string, state: DraftSnapshot) {
    this.states.set(key, state);
    this.listeners.forEach((listener) => listener());
  }
  update = (key: string, edit: (draft: ComposerDraft) => ComposerDraft) => {
    if (this.removed.has(key)) return;
    const state = this.get(key);
    this.publish(key, { ...state, draft: edit(state.draft) });
  };
  clearIfUnchanged(key: string, draft: ComposerDraft) {
    if (this.get(key).draft === draft) {
      this.update(key, () => EMPTY_DRAFT);
      this.setSending(key, false);
    }
  }
  setSending(key: string, sending: boolean) {
    const state = this.get(key);
    this.publish(key, { ...state, sending, sendingDraft: sending ? state.draft : undefined });
  }
  finishSending(draft: ComposerDraft) {
    // The send owns its original snapshot even if a late input/file update
    // replaces the visible draft. Unlock it without clearing newer content.
    for (const [key, state] of this.states) {
      if (state.sending && state.sendingDraft === draft) {
        this.setSending(key, false);
      }
    }
  }
  transfer(from: string, to: string) {
    const state = this.get(from);
    this.publish(to, state);
    this.clearIfUnchanged(from, state.draft);
  }
  discard(key: string) {
    if (this.get(key).sending || !this.states.delete(key)) return;
    this.listeners.forEach((listener) => listener());
  }
  remove(key: string) {
    this.removed.add(key);
    this.publish(key, EMPTY);
  }
}
