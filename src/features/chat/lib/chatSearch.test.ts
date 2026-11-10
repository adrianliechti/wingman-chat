import { expect, it } from "vitest";
import { searchExcerpt } from "./chatSearch";
import { textMatches } from "@/shared/lib/textSearch";

it("centers excerpts on a late match and collapses whitespace", () => {
  const excerpt = searchExcerpt(`${"Before ".repeat(100)}THE\nNEEDLE ${"After ".repeat(100)}`, "the\nneedle");
  expect(excerpt).toContain("THE NEEDLE");
  expect(excerpt.startsWith("…")).toBe(true);
  expect(excerpt.endsWith("…")).toBe(true);
  expect(excerpt.length).toBeLessThan(200);
});

it("treats search punctuation literally and preserves Unicode character offsets", () => {
  expect(textMatches("İ followed by [A+B] and [a+b]", "[a+b]")).toEqual([
    { index: 14, text: "[A+B]" },
    { index: 24, text: "[a+b]" },
  ]);
  expect(textMatches("text", "")).toEqual([]);
});
