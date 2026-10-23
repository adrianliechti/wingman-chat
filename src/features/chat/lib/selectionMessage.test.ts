import { describe, expect, it } from "vitest";
import { textMetadata } from "@/shared/lib/messages";
import { buildSelectionEditMessage } from "./selectionMessage";

describe("buildSelectionEditMessage", () => {
  it("puts the trimmed instruction first and the selection after it", () => {
    const message = buildSelectionEditMessage({
      path: "/notes.md",
      text: "Quarterly revenue grew.",
      startLine: 3,
      endLine: 3,
      instruction: "  Make it shorter \n",
    });
    expect(message.role).toBe("user");
    expect(message.parts[0]).toEqual({ type: "text", content: "Make it shorter" });
    const selection = message.parts[1];
    if (selection.type !== "text") throw new Error("Expected a text part");
    expect(selection.content).toContain("Selected text in /notes.md (line 3)");
    expect(textMetadata(selection).artifactSelection).toEqual({
      path: "/notes.md",
      text: "Quarterly revenue grew.",
      startLine: 3,
      endLine: 3,
    });
  });

  it("leaves lines out when the passage was not located", () => {
    const message = buildSelectionEditMessage({ path: "/a.html", text: "Hello", instruction: "Bold it" });
    const selection = message.parts[1];
    if (selection.type !== "text") throw new Error("Expected a text part");
    expect(textMetadata(selection).artifactSelection).toEqual({ path: "/a.html", text: "Hello" });
  });
});
