import { describe, expect, it } from "vitest";
import { applyEntriesInPlace, decodeLines, diffChat, encodeLines, replayLog } from "./chatLog";
import type { StoredChat, StoredMessage } from "./opfs-chat";

function msg(text: string, role: StoredMessage["role"] = "user"): StoredMessage {
  return { role, content: [{ type: "text", text }] };
}

function chat(over: Partial<StoredChat> = {}): StoredChat {
  return { id: "c1", created: "2026-01-01T00:00:00Z", updated: null, model: null, messages: [], ...over };
}

/** apply(diff(prev, next), prev) must equal next. */
function roundTrip(prev: StoredChat | null, next: StoredChat): void {
  const entries = diffChat(prev, next);
  const result = applyEntriesInPlace(prev, entries, next.id);
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

describe("replay edge cases", () => {
  it("tombstone yields null", () => {
    const entries = [...diffChat(null, chat({ messages: [msg("a")] })), { type: "tombstone" } as const];
    expect(replayLog("c1", entries).chat).toBeNull();
    expect(applyEntriesInPlace(chat({ messages: [msg("a")] }), [{ type: "tombstone" }], "c1")).toBeNull();
  });

  it("out-of-range replace is ignored", () => {
    const base = chat({ messages: [msg("a")] });
    const result = applyEntriesInPlace(base, [{ type: "replace", index: 5, message: msg("x") }], "c1");
    expect(result?.messages).toEqual([msg("a")]);
  });

  it("replace at length appends", () => {
    const base = chat({ messages: [msg("a")] });
    const result = applyEntriesInPlace(base, [{ type: "replace", index: 1, message: msg("b") }], "c1");
    expect(result?.messages).toEqual([msg("a"), msg("b")]);
  });

  it("init resets identity but a fresh replay starts empty", () => {
    const snapshot = diffChat(null, chat({ title: "t", messages: [msg("a"), msg("b")] }));
    // A compaction snapshot replayed on its own reproduces the full chat.
    expect(replayLog("c1", snapshot).chat).toEqual(chat({ title: "t", messages: [msg("a"), msg("b")] }));
  });
});
