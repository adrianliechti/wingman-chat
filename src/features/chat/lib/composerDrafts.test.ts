import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { PersistenceQueue } from "@/shared/lib/persistence";
import { ComposerDraftStore, EMPTY_DRAFT, loadComposerDraft, saveComposerDraft } from "./composerDrafts";

const disk = new MemoryOpfs();
beforeEach(() => {
  disk.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => disk.root } });
});
afterEach(() => vi.unstubAllGlobals());

describe("composer drafts", () => {
  it("persists skill-only drafts and clears them only after acceptance", async () => {
    const queue = new PersistenceQueue(() => {}, 60_000);
    const store = new ComposerDraftStore(queue);
    await store.load("new-project");
    store.update("new-project", () => ({ ...EMPTY_DRAFT, skills: ["draft-response", "support:escalate"] }));
    await queue.flush();
    expect((await loadComposerDraft("new-project")).skills).toEqual(["draft-response", "support:escalate"]);
    const sent = store.get("new-project").draft;
    store.setSending("new-project", true);
    await store.transfer("new-project", "chat-created");
    expect((await loadComposerDraft("chat-created")).skills).toEqual(sent.skills);
    store.finishSending(sent);
    store.clearIfUnchanged("chat-created", sent);
    await queue.flush();
    expect(await loadComposerDraft("chat-created")).toEqual(EMPTY_DRAFT);
    await queue.stop();
  });

  it("restores text, inline media and original binary files independently per conversation", async () => {
    const file = new File([new Uint8Array([0, 1, 255, 7])], "source.bin", {
      type: "application/octet-stream",
      lastModified: 42,
    });
    const image = new File(["image bytes"], "photo.png", { type: "image/png" });
    const draft = {
      content: "Please review",
      pendingFiles: [file],
      pendingImages: [image],
      attachments: [
        { type: "image" as const, source: { type: "data" as const, value: "aW1hZ2U=", mimeType: "image/png" } },
      ],
    };
    await saveComposerDraft("new-chat", { ...EMPTY_DRAFT, content: "Another draft" });
    await saveComposerDraft("chat-one", draft);
    const restored = await loadComposerDraft("chat-one");
    expect(restored.content).toBe(draft.content);
    expect(restored.attachments).toEqual(draft.attachments);
    expect([...new Uint8Array(await restored.pendingFiles[0].arrayBuffer())]).toEqual([0, 1, 255, 7]);
    expect(restored.pendingFiles[0]).toMatchObject({ name: "source.bin", type: file.type, lastModified: 42 });
    expect(await restored.pendingImages[0]!.text()).toBe("image bytes");
    expect((await loadComposerDraft("new-chat")).content).toBe("Another draft");
    await saveComposerDraft("chat-one", EMPTY_DRAFT);
    expect(await loadComposerDraft("chat-one")).toEqual(EMPTY_DRAFT);
    expect((await loadComposerDraft("new-chat")).content).toBe("Another draft");
  });

  it("keeps the previous durable draft when attachment persistence fails", async () => {
    await saveComposerDraft("chat-one", { ...EMPTY_DRAFT, content: "recoverable" });
    disk.beforeWrite = async (path) => {
      if (path.includes("/files/")) throw new Error("quota");
    };
    await expect(
      saveComposerDraft("chat-one", {
        ...EMPTY_DRAFT,
        content: "new",
        pendingFiles: [new File(["bytes"], "file.txt")],
      }),
    ).rejects.toThrow("quota");
    expect((await loadComposerDraft("chat-one")).content).toBe("recoverable");
  });

  it("transfers a new-chat draft and clears only the accepted snapshot", async () => {
    const queue = new PersistenceQueue(() => {}, 60_000);
    const store = new ComposerDraftStore(queue);
    await store.load("new-project");
    store.update("new-project", () => ({ ...EMPTY_DRAFT, content: "Send this" }));
    const sent = store.get("new-project").draft;
    store.setSending("new-project", true);
    await store.transfer("new-project", "chat-created");
    expect(store.get("chat-created")).toMatchObject({ draft: sent, sending: true });
    expect(store.get("new-project")).toMatchObject({ draft: EMPTY_DRAFT, sending: false });
    store.finishSending(sent);
    store.update("chat-created", (d) => ({ ...d, content: "A newer draft" }));
    store.clearIfUnchanged("chat-created", sent);
    await queue.flush();
    expect((await loadComposerDraft("chat-created")).content).toBe("A newer draft");
    expect(await loadComposerDraft("new-project")).toEqual(EMPTY_DRAFT);
    await queue.stop();
  });

  it("does not resurrect a deleted chat from a delayed load or file conversion", async () => {
    let finish!: (draft: typeof EMPTY_DRAFT) => void;
    const save = vi.fn(async () => {});
    const queue = new PersistenceQueue(() => {}, 60_000);
    const store = new ComposerDraftStore(queue, {
      load: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      save,
    });
    const loading = store.load("chat-deleted");
    store.remove("chat-deleted");
    finish({ ...EMPTY_DRAFT, content: "old draft" });
    await loading;
    store.update("chat-deleted", (d) => ({ ...d, pendingFiles: [new File(["late"], "late.txt")] }));
    await queue.flush();
    expect(store.get("chat-deleted").draft).toEqual(EMPTY_DRAFT);
    expect(save).toHaveBeenLastCalledWith("chat-deleted", EMPTY_DRAFT);
    await queue.stop();
  });
});
