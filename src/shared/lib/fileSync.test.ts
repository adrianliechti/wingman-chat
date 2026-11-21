import { describe, expect, it } from "vitest";
import { mergeIndexEntries } from "./fileSync";
import type { IndexEntry } from "./opfs-core";

function entry(id: string, updated: string, title?: string): IndexEntry {
  return { id, updated, title };
}

describe("mergeIndexEntries", () => {
  it("unions entries created on different devices", () => {
    const a = [entry("x", "2026-01-01T00:00:00Z")];
    const b = [entry("y", "2026-01-02T00:00:00Z")];
    const merged = mergeIndexEntries(a, b);
    expect(merged.map((e) => e.id)).toEqual(["x", "y"]);
  });

  it("keeps the newer version of the same entry", () => {
    const a = [entry("x", "2026-01-01T00:00:00Z", "old")];
    const b = [entry("x", "2026-06-01T00:00:00Z", "new")];
    expect(mergeIndexEntries(a, b)).toEqual([entry("x", "2026-06-01T00:00:00Z", "new")]);
    expect(mergeIndexEntries(b, a)).toEqual([entry("x", "2026-06-01T00:00:00Z", "new")]);
  });

  it("is deterministic regardless of input order", () => {
    const a = [entry("b", "2026-01-01T00:00:00Z"), entry("a", "2026-01-01T00:00:00Z")];
    const b = [entry("c", "2026-01-01T00:00:00Z")];
    expect(mergeIndexEntries(a, b)).toEqual(mergeIndexEntries(b, a));
    expect(mergeIndexEntries(a, b).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("tolerates malformed entries and missing timestamps", () => {
    const a = [entry("x", ""), null as unknown as IndexEntry, { title: "no id" } as IndexEntry];
    const b = [entry("x", "2026-01-01T00:00:00Z")];
    expect(mergeIndexEntries(a, b)).toEqual([entry("x", "2026-01-01T00:00:00Z")]);
  });
});
