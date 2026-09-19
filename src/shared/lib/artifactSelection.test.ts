import { describe, expect, it } from "vitest";
import { formatArtifactSelection } from "./artifactSelection";

describe("formatArtifactSelection", () => {
  it("quotes the passage with its file and line range", () => {
    expect(
      formatArtifactSelection({
        type: "artifact_selection",
        path: "/report.md",
        text: "Revenue grew.\n",
        startLine: 12,
        endLine: 14,
      }),
    ).toBe("Selected text in /report.md (lines 12-14):\n```\nRevenue grew.\n```");
  });

  it("names a single line and omits unknown locations", () => {
    expect(
      formatArtifactSelection({ type: "artifact_selection", path: "/a.md", text: "x", startLine: 3, endLine: 3 }),
    ).toContain("(line 3)");
    expect(formatArtifactSelection({ type: "artifact_selection", path: "/a.md", text: "x" })).toBe(
      "Selected text in /a.md:\n```\nx\n```",
    );
  });

  it("uses a fence longer than any backtick run in the text", () => {
    const rendered = formatArtifactSelection({
      type: "artifact_selection",
      path: "/a.md",
      text: "see ```js\ncode\n```",
    });
    expect(rendered.startsWith("Selected text in /a.md:\n````\n")).toBe(true);
    expect(rendered.endsWith("\n````")).toBe(true);
  });
});
