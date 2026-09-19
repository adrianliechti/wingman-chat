import { describe, expect, it } from "vitest";
import { buildSelectionEditMessage } from "./selectionMessage";

describe("buildSelectionEditMessage", () => {
  it("puts the trimmed instruction first and the selection after it", () => {
    expect(
      buildSelectionEditMessage({
        path: "/notes.md",
        text: "Quarterly revenue grew.",
        startLine: 3,
        endLine: 3,
        instruction: "  Make it shorter \n",
      }),
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Make it shorter" },
        { type: "artifact_selection", path: "/notes.md", text: "Quarterly revenue grew.", startLine: 3, endLine: 3 },
      ],
    });
  });

  it("leaves lines out when the passage was not located", () => {
    const message = buildSelectionEditMessage({ path: "/a.html", text: "Hello", instruction: "Bold it" });
    expect(message.content[1]).toEqual({ type: "artifact_selection", path: "/a.html", text: "Hello" });
  });
});
