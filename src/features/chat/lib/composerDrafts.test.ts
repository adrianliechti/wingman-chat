import { describe, expect, it } from "vitest";
import { ComposerDraftStore, EMPTY_DRAFT } from "./composerDrafts";

describe("composer drafts", () => {
  it.each([
    { outcome: "accepted", transfer: false },
    { outcome: "failed", transfer: false },
    { outcome: "accepted", transfer: true },
    { outcome: "failed", transfer: true },
  ])("unlocks a changed draft after $outcome (transfer=$transfer)", ({ outcome, transfer }) => {
    const store = new ComposerDraftStore();
    store.update("new-chat", () => ({ ...EMPTY_DRAFT, content: "Submitted text" }));
    const sent = store.get("new-chat").draft;
    store.setSending("new-chat", true);
    store.update("new-chat", (draft) => ({ ...draft, content: "Unsent changes" }));
    if (transfer) store.transfer("new-chat", "chat-created");
    const key = transfer ? "chat-created" : "new-chat";
    store.finishSending(sent);
    if (outcome === "accepted") store.clearIfUnchanged(key, sent);
    expect(store.get(key).sending).toBe(false);
    expect(store.get(key).draft.content).toBe("Unsent changes");
  });

  it("does not unlock a newer submission when an older send finishes again", () => {
    const store = new ComposerDraftStore();
    store.update("chat-one", () => ({ ...EMPTY_DRAFT, content: "First" }));
    const first = store.get("chat-one").draft;
    store.setSending("chat-one", true);
    store.finishSending(first);
    store.clearIfUnchanged("chat-one", first);
    store.update("chat-one", (draft) => ({ ...draft, content: "Second" }));
    const second = store.get("chat-one").draft;
    store.setSending("chat-one", true);
    store.finishSending(first);
    store.clearIfUnchanged("chat-one", first);
    expect(store.get("chat-one").sending).toBe(true);
    expect(store.get("chat-one").draft).toBe(second);
    store.finishSending(second);
    expect(store.get("chat-one").sending).toBe(false);
  });

  it("transfers a new-chat draft and clears only the accepted snapshot", () => {
    const store = new ComposerDraftStore();
    store.update("new-project", () => ({ ...EMPTY_DRAFT, content: "Send this" }));
    const sent = store.get("new-project").draft;
    store.setSending("new-project", true);
    store.transfer("new-project", "chat-created");
    expect(store.get("chat-created")).toMatchObject({ draft: sent, sending: true });
    expect(store.get("new-project")).toMatchObject({ draft: EMPTY_DRAFT, sending: false });
    store.finishSending(sent);
    store.update("chat-created", (d) => ({ ...d, content: "A newer draft" }));
    store.clearIfUnchanged("chat-created", sent);
    expect(store.get("chat-created").draft.content).toBe("A newer draft");
  });

  it("discards an idle draft but keeps one that is still sending", () => {
    const store = new ComposerDraftStore();
    store.update("chat-one", () => ({ ...EMPTY_DRAFT, content: "Leave me" }));
    store.discard("chat-one");
    expect(store.get("chat-one").draft).toEqual(EMPTY_DRAFT);
    store.update("chat-two", () => ({ ...EMPTY_DRAFT, content: "In flight" }));
    store.setSending("chat-two", true);
    store.discard("chat-two");
    expect(store.get("chat-two").draft.content).toBe("In flight");
  });

  it("does not resurrect a deleted chat from a late file conversion", () => {
    const store = new ComposerDraftStore();
    store.remove("chat-deleted");
    store.update("chat-deleted", (d) => ({ ...d, pendingFiles: [new File(["late"], "late.txt")] }));
    expect(store.get("chat-deleted").draft).toEqual(EMPTY_DRAFT);
  });
});
