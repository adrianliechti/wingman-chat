import { describe, expect, it } from "vitest";
import { getToolCallPreview, toolPreviewList, toolPreviewPath, toolPreviewText } from "./toolPreview";

describe("tool previews", () => {
  it.each(["path", "file_path", "filePath", "filepath", "filename", "file_name", "fileName"])(
    "prefers the %s filename to HTML content",
    (key) =>
      expect(getToolCallPreview({ [key]: "/pages/dashboard.html", content: "<html>...</html>" })).toBe(
        "pages/dashboard.html",
      ),
  );

  it("recognizes external tool queries, patterns, commands and batched paths", () => {
    expect(getToolCallPreview({ pattern: "TODO" })).toBe("TODO");
    expect(getToolCallPreview({ cmd: "ls -l" })).toBe("ls -l");
    expect(getToolCallPreview({ queries: ["one", "two", "three"], prompt: "long instructions" })).toBe(
      "3 queries: one, two",
    );
    expect(getToolCallPreview({ paths: ["/a.md", "/b.md"] })).toBe("2 files: a.md, b.md");
    expect(getToolCallPreview({ path: "/new.md", file_path: "/old.md" })).toBe("new.md");
    expect(getToolCallPreview({ title: " ", query: "actual query" })).toBe("actual query");
  });

  it("does not expose payloads as hints", () => {
    expect(getToolCallPreview({ content: "<html>...</html>", body: "large body", data: "binary" })).toBeNull();
    expect(getToolCallPreview({ image: "data:image/png;base64,aGVsbG8=", prompt: "a landscape" })).toBe("a landscape");
    expect(toolPreviewText(" data:image/png;base64,aGVsbG8= ")).toBeNull();
    expect(toolPreviewList([null, "", 42, " data:text/plain;base64,aA== "])).toBeNull();
  });

  it("keeps hints compact and retains the workspace root", () => {
    expect(toolPreviewText("  one\n  two\tthree  ")).toBe("one two three");
    expect(toolPreviewText("a".repeat(200))).toBe(`${"a".repeat(159)}…`);
    expect(toolPreviewPath("/")).toBe("/");
    expect(toolPreviewPath("/nested/report.html")).toBe("nested/report.html");
    expect(toolPreviewList(["one", null, " ", "two", "three"])).toBe("3 items: one, two");
  });
});
