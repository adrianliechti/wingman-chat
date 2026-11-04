// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { replaceContext, selectionOffsets } from "./selection";

describe("selection offsets", () => {
  it("reads offsets from the live selection inside the container", () => {
    const container = document.createElement("div");
    container.textContent = "Hallo schöne Welt";
    document.body.appendChild(container);
    const node = container.firstChild!;
    const range = document.createRange();
    range.setStart(node, 6);
    range.setEnd(node, 12);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionOffsets(container, container.textContent, "schöne")).toEqual({ start: 6, end: 12 });
    selection.removeAllRanges();
    container.remove();
  });

  it("falls back to the first occurrence without a live selection", () => {
    const container = document.createElement("div");
    container.textContent = "a b a";
    expect(selectionOffsets(container, "a b a", "a")).toEqual({ start: 0, end: 1 });
    expect(selectionOffsets(container, "a b a", "z")).toBeNull();
  });

  it("replaces only the first matching context", () => {
    expect(replaceContext("x. y. x.", "x.", "z.")).toBe("z. y. x.");
    expect(replaceContext("abc", "q", "z")).toBe("abc");
  });
});
