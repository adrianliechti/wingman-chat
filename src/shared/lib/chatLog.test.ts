import { describe, expect, it } from "vitest";
import { applyEntries, chunkEntries, decodeLines, diffChat, encodeLines, replayLog } from "./chatLog";
import { STORED_CHAT_VERSION, type StoredChat } from "./opfs-chat";

type StoredMessage = StoredChat["messages"][number];

function msg(text: string, role: StoredMessage["role"] = "user"): StoredMessage {
  return { id: text, role, parts: [{ type: "text", content: text }] };
}

function chat(over: Partial<StoredChat> = {}): StoredChat {
  return {
    version: STORED_CHAT_VERSION,
    id: "c1",
    created: "2026-01-01T00:00:00Z",
    updated: null,
    model: null,
    messages: [],
    ...over,
  };
}

/** apply(diff(prev, next), prev) must equal next. */
function roundTrip(prev: StoredChat | null, next: StoredChat): void {
  const entries = diffChat(prev, next);
  const result = applyEntries(prev, entries, next.id);
  expect(result).toEqual(next);
}

describe("codec", () => {
  it("encodes and decodes entries", () => {
    const entries = diffChat(null, chat({ title: "t", messages: [msg("hi")] }));
    expect(decodeLines(encodeLines(entries))).toEqual(entries);
  });

  it("skips malformed lines", () => {
    const text = `${JSON.stringify({ type: "tombstone" })}\nnot json\n`;
    expect(decodeLines(text)).toEqual([{ type: "tombstone" }]);
  });

  it("encodes empty input to empty string", () => {
    expect(encodeLines([])).toBe("");
  });
});

describe("diff + replay round-trips", () => {
  it("preserves, changes, and clears project and agent assignments over the wire", () => {
    const first = chat({ projectId: "project", agentId: "agent" });
    const next = chat({ projectId: "other-project", agentId: null });
    for (const [previous, target] of [
      [null, first],
      [first, next],
      [next, chat()],
    ] as const) {
      const entries = decodeLines(encodeLines(diffChat(previous, target)));
      expect(applyEntries(previous, entries, target.id)).toEqual(target);
    }
  });
  it("preserves native resume state and chat metadata through snapshots and deltas", () => {
    const first = chat({
      resume: { resumeState: { threadId: "thread", runId: "run-one" } },
      metadata: { classification: { category: "coding" } },
      messages: [msg("hello")],
    });
    roundTrip(null, first);
    const next = chat({
      ...first,
      resume: { resumeState: { threadId: "thread", runId: "run-two" } },
      metadata: { classification: { category: "research" } },
    });
    roundTrip(first, next);
    roundTrip(next, chat({ messages: [msg("hello")] }));
  });

  it("first sync (init + meta + messages)", () => {
    roundTrip(
      null,
      chat({ title: "hello", updated: "2026-01-02T00:00:00Z", messages: [msg("a"), msg("b", "assistant")] }),
    );
  });

  it("append messages", () => {
    const a = chat({ messages: [msg("a")] });
    roundTrip(a, chat({ messages: [msg("a"), msg("b", "assistant")] }));
  });

  it("regenerate last message (single replace)", () => {
    const a = chat({ messages: [msg("q"), msg("v1", "assistant")] });
    const b = chat({ messages: [msg("q"), msg("v2", "assistant")] });
    const entries = diffChat(a, b);
    expect(entries).toEqual([{ type: "replace", index: 1, message: msg("v2", "assistant") }]);
    roundTrip(a, b);
  });

  it("delete tail messages (truncate)", () => {
    const a = chat({ messages: [msg("a"), msg("b"), msg("c")] });
    roundTrip(a, chat({ messages: [msg("a")] }));
  });

  it("edit a middle message (truncate + re-append)", () => {
    const a = chat({ messages: [msg("a"), msg("b"), msg("c")] });
    roundTrip(a, chat({ messages: [msg("a"), msg("B"), msg("c")] }));
  });

  it("meta-only change emits a single meta entry", () => {
    const a = chat({ title: "old", messages: [msg("a")] });
    const b = chat({ title: "new", customIndex: 3, messages: [msg("a")] });
    const entries = diffChat(a, b);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("meta");
    roundTrip(a, b);
  });

  it("clearing meta fields round-trips", () => {
    const a = chat({ title: "t", customTitle: "ct", messages: [] });
    roundTrip(a, chat({ messages: [] }));
  });

  it("identical chats produce an empty diff", () => {
    const a = chat({ title: "t", messages: [msg("a")] });
    expect(diffChat(a, chat({ title: "t", messages: [msg("a")] }))).toEqual([]);
  });
});

describe("chunkEntries", () => {
  it("keeps small batches in one chunk", () => {
    const entries = diffChat(null, chat({ messages: [msg("a"), msg("b")] }));
    expect(chunkEntries(entries)).toEqual([entries]);
  });

  it("splits when the plaintext budget is exceeded and preserves order", () => {
    const big = "x".repeat(3 * 1024 * 1024);
    const entries = diffChat(null, chat({ messages: [msg(big), msg(big), msg("tail")] }));
    const chunks = chunkEntries(entries);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(entries);
    // every chunk carries at least one entry, even oversized ones
    for (const c of chunks) expect(c.length).toBeGreaterThan(0);
  });

  it("counts UTF-8 bytes when splitting non-ASCII messages", () => {
    const entry = { type: "message", ...msg("界".repeat(400_000)) } as const;
    // Each message contains the text twice (id + content): ~2.4 MiB in UTF-8.
    const chunks = chunkEntries([entry, entry]);
    expect(chunks).toEqual([[entry], [entry]]);
  });

  it("rejects a single entry whose UTF-8 encoding cannot fit the server frame cap", () => {
    const entry = { type: "message", ...msg("界".repeat(2 * 1024 * 1024)) } as const;
    expect(() => chunkEntries([entry])).toThrow(/too large to sync/);
  });

  it("returns nothing for an empty batch", () => {
    expect(chunkEntries([])).toEqual([]);
  });
});

describe("replay edge cases", () => {
  it("applies deltas without modifying the baseline or serializing unchanged messages", () => {
    const unchanged = msg("old");
    const base = chat({ title: "old title", messages: [unchanged] });
    Object.defineProperty(unchanged, "toJSON", {
      value: () => {
        throw new Error("Unchanged messages should not be serialized while applying a delta");
      },
    });
    const result = applyEntries(
      base,
      [
        { type: "meta", title: "new title" },
        { type: "message", ...msg("new") },
      ],
      "c1",
    );
    expect(base.title).toBe("old title");
    expect(base.messages).toHaveLength(1);
    expect(result?.title).toBe("new title");
    expect(result?.messages).toEqual([unchanged, msg("new")]);
  });

  it("tombstone yields null", () => {
    const entries = [...diffChat(null, chat({ messages: [msg("a")] })), { type: "tombstone" } as const];
    expect(replayLog("c1", entries).chat).toBeNull();
    expect(applyEntries(chat({ messages: [msg("a")] }), [{ type: "tombstone" }], "c1")).toBeNull();
  });

  it("out-of-range replace is ignored", () => {
    const base = chat({ messages: [msg("a")] });
    const result = applyEntries(base, [{ type: "replace", index: 5, message: msg("x") }], "c1");
    expect(result?.messages).toEqual([msg("a")]);
  });

  it("replace at length appends", () => {
    const base = chat({ messages: [msg("a")] });
    const result = applyEntries(base, [{ type: "replace", index: 1, message: msg("b") }], "c1");
    expect(result?.messages).toEqual([msg("a"), msg("b")]);
  });

  it("init resets identity but a fresh replay starts empty", () => {
    const snapshot = diffChat(null, chat({ title: "t", messages: [msg("a"), msg("b")] }));
    // A compaction snapshot replayed on its own reproduces the full chat.
    expect(replayLog("c1", snapshot).chat).toEqual(chat({ title: "t", messages: [msg("a"), msg("b")] }));
  });

  it("an init snapshot applied over existing state replaces it, not duplicates it", () => {
    const baseline = chat({ title: "old", messages: [msg("a"), msg("b")] });
    const snapshot = diffChat(null, chat({ title: "new", messages: [msg("a"), msg("b")] }));
    expect(applyEntries(baseline, snapshot, "c1")).toEqual(chat({ title: "new", messages: [msg("a"), msg("b")] }));
  });
});
