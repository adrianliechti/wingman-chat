import { describe, expect, it } from "vitest";
import { detectIndent, indentSelection, newlineWithIndent, type SourceEdit } from "./sourceEditing";

/** Applies an edit at the `|` caret (or `[`…`]` selection) and marks the result the same way. */
function apply(marked: string, run: (text: string, start: number, end: number) => SourceEdit | null): string | null {
  const caret = marked.indexOf("|");
  const start = caret === -1 ? marked.indexOf("[") : caret;
  const end = caret === -1 ? marked.indexOf("]") - 1 : caret;
  const text = caret === -1 ? marked.replace("[", "").replace("]", "") : marked.replace("|", "");
  const edit = run(text, start, end);
  if (!edit) return null;
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const { start: from, end: to } = edit.selection;
  return from === to
    ? `${next.slice(0, from)}|${next.slice(from)}`
    : `${next.slice(0, from)}[${next.slice(from, to)}]${next.slice(to)}`;
}

describe("detectIndent", () => {
  it("finds tabs or the smallest space indent", () => {
    expect(detectIndent("a\n\tb\n\t\tc")).toBe("\t");
    expect(detectIndent("a\n    b\n        c")).toBe("    ");
    expect(detectIndent("a\n  b\n    c")).toBe("  ");
    expect(detectIndent("flat", "    ")).toBe("    ");
  });
});

describe("indentSelection", () => {
  const indent = (text: string, start: number, end: number) => indentSelection(text, start, end, "  ", 1);
  const outdent = (text: string, start: number, end: number) => indentSelection(text, start, end, "  ", -1);

  it("inserts one unit at a caret", () => {
    expect(apply("a|b", indent)).toBe("a  |b");
  });

  it("indents and outdents every selected line, skipping blank ones", () => {
    expect(apply("[one\n\ntwo]", indent)).toBe("  [one\n\n  two]");
    expect(apply("  [one\n    two]", outdent)).toBe("[one\n  two]");
    expect(apply("\t|tabbed", outdent)).toBe("|tabbed");
    expect(apply("flat|", outdent)).toBeNull();
  });
});

describe("newlineWithIndent", () => {
  it("keeps the current indentation", () => {
    expect(apply("    value = 1|", (text, start, end) => newlineWithIndent(text, start, end))).toBe(
      "    value = 1\n    |",
    );
  });

  it("indents after an opening bracket and moves its closer down", () => {
    const js = (text: string, start: number, end: number) => newlineWithIndent(text, start, end, "js");
    expect(apply("if (x) {|}", js)).toBe("if (x) {\n  |\n}");
    expect(apply("  call(|", js)).toBe("  call(\n    |");
  });

  it("indents after a colon only in Python-like languages", () => {
    expect(apply("def f():|", (text, start, end) => newlineWithIndent(text, start, end, "py"))).toBe("def f():\n    |");
    expect(apply("Note:|", (text, start, end) => newlineWithIndent(text, start, end))).toBe("Note:\n|");
    expect(apply("a: b:|", (text, start, end) => newlineWithIndent(text, start, end, "js"))).toBe("a: b:\n|");
  });
});
