import { describe, expect, it } from "vitest";
import {
  continueListOnEnter,
  shiftListItems,
  toggleInlineFormat,
  toggleTask,
  type InlineFormat,
} from "./markdownFormatting";

/** Applies a toggle to the `[`…`]`-marked selection and marks the resulting selection the same way. */
function toggle(marked: string, format: InlineFormat): string {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
  const edit = toggleInlineFormat(text, start, end, format);
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return `${next.slice(0, edit.selection.start)}[${next.slice(edit.selection.start, edit.selection.end)}]${next.slice(edit.selection.end)}`;
}

describe("toggleInlineFormat", () => {
  it("wraps a selection and keeps the text selected", () => {
    expect(toggle("a [word] b", "bold")).toBe("a **[word]** b");
    expect(toggle("a [word] b", "italic")).toBe("a _[word]_ b");
    expect(toggle("a [word] b", "strike")).toBe("a ~~[word]~~ b");
    expect(toggle("a [word] b", "code")).toBe("a `[word]` b");
  });

  it("keeps surrounding whitespace outside the delimiters", () => {
    expect(toggle("a[ word ]b", "bold")).toBe("a **[word]** b");
  });

  it("unwraps delimiters around or inside the selection", () => {
    expect(toggle("a **[word]** b", "bold")).toBe("a [word] b");
    expect(toggle("a [**word**] b", "bold")).toBe("a [word] b");
    expect(toggle("a __[word]__ b", "bold")).toBe("a [word] b");
    expect(toggle("a *[word]* b", "italic")).toBe("a [word] b");
    expect(toggle("a ~~[word]~~ b", "strike")).toBe("a [word] b");
  });

  it("does not mistake bold for italics", () => {
    expect(toggle("a **[word]** b", "italic")).toBe("a **_[word]_** b");
    expect(toggle("a ***[word]*** b", "italic")).toBe("a **[word]** b");
  });

  it("turns a selection into a link and selects the destination", () => {
    expect(toggle("see [docs] now", "link")).toBe("see [docs]([url]) now");
    expect(toggle("see [https://x.io] now", "link")).toBe("see [[https://x.io]](https://x.io) now");
  });
});

/** Applies an edit at the `|` caret (or `[`…`]` selection) and marks the result the same way. */
function apply(
  marked: string,
  run: (text: string, start: number, end: number) => ReturnType<typeof continueListOnEnter>,
): string | null {
  const caret = marked.indexOf("|");
  const start = caret === -1 ? marked.indexOf("[") : caret;
  const end = caret === -1 ? marked.indexOf("]") - 1 : caret;
  const text = caret === -1 ? marked.replace("[", "").replace("]", "") : marked.replace("|", "");
  const edit = run(text, start, end);
  if (!edit) return null;
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  if (edit.selection.start === edit.selection.end) {
    return `${next.slice(0, edit.selection.start)}|${next.slice(edit.selection.start)}`;
  }
  return `${next.slice(0, edit.selection.start)}[${next.slice(edit.selection.start, edit.selection.end)}]${next.slice(edit.selection.end)}`;
}

describe("continueListOnEnter", () => {
  it("continues bullets, numbers, tasks and quotes", () => {
    expect(apply("- one|", continueListOnEnter)).toBe("- one\n- |");
    expect(apply("  * nested|", continueListOnEnter)).toBe("  * nested\n  * |");
    expect(apply("9. nine|", continueListOnEnter)).toBe("9. nine\n10. |");
    expect(apply("3) three|", continueListOnEnter)).toBe("3) three\n4) |");
    expect(apply("- [x] done|", continueListOnEnter)).toBe("- [x] done\n- [ ] |");
    expect(apply("> - quoted|", continueListOnEnter)).toBe("> - quoted\n> - |");
    expect(apply("> said|", continueListOnEnter)).toBe("> said\n> |");
  });

  it("splits an item when the caret is inside its text", () => {
    expect(apply("- one| two", continueListOnEnter)).toBe("- one\n- | two");
  });

  it("ends an empty item or quote line, outdenting a nested one first", () => {
    expect(apply("- one\n- |", continueListOnEnter)).toBe("- one\n|");
    expect(apply("- one\n- [ ] |", continueListOnEnter)).toBe("- one\n|");
    expect(apply("- one\n  - |", continueListOnEnter)).toBe("- one\n- |");
    expect(apply("> a\n> |", continueListOnEnter)).toBe("> a\n|");
  });

  it("leaves ordinary lines and carets inside a marker to the default newline", () => {
    expect(apply("plain|", continueListOnEnter)).toBeNull();
    expect(apply("-| one", continueListOnEnter)).toBeNull();
    expect(apply("- [one] two", continueListOnEnter)).toBeNull();
  });
});

describe("shiftListItems", () => {
  const indent = (text: string, start: number, end: number) => shiftListItems(text, start, end, 1);
  const outdent = (text: string, start: number, end: number) => shiftListItems(text, start, end, -1);

  it("nests an item under the content column of the item before it", () => {
    expect(apply("- one\n- two|", indent)).toBe("- one\n  - two|");
    expect(apply("1. one\n2. two|", indent)).toBe("1. one\n   2. two|");
    expect(apply("- [ ] one\n- [ ] two|", indent)).toBe("- [ ] one\n  - [ ] two|");
  });

  it("outdents to the parent's indentation", () => {
    expect(apply("1. one\n   - two|", outdent)).toBe("1. one\n- two|");
    expect(apply("- top|", outdent)).toBeNull();
  });

  it("shifts every selected line", () => {
    expect(apply("- one\n[- two\n- three]", indent)).toBe("- one\n  [- two\n  - three]");
  });

  it("ignores lines that are not list items", () => {
    expect(apply("text|", indent)).toBeNull();
    expect(apply("> - quoted|", indent)).toBeNull();
  });
});

describe("toggleTask", () => {
  it("flips the n-th task box", () => {
    const source = "- [ ] a\n- [x] b\n1. [X] c\n> - [ ] d";
    expect(toggleTask(source, 0)).toBe("- [x] a\n- [x] b\n1. [X] c\n> - [ ] d");
    expect(toggleTask(source, 2)).toBe("- [ ] a\n- [x] b\n1. [ ] c\n> - [ ] d");
    expect(toggleTask(source, 3)).toBe("- [ ] a\n- [x] b\n1. [X] c\n> - [x] d");
    expect(toggleTask(source, 4)).toBeNull();
  });
});
