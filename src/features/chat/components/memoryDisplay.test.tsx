import { BrainCircuit, FileText } from "lucide-react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Message, Tool } from "@/shared/types/chat";
import { resolveToolHeader } from "./toolDisplay";
import { ChatToolMessage } from "./ChatToolMessage";
import { collectTurnArtifactPaths, summarizeToolGroup } from "./chatMessageUtils";

vi.mock("@/features/tools/hooks/useToolsContext", () => ({ useToolsContext: () => ({ providers: [] }) }));
vi.mock("@/features/chat/hooks/useChat", () => ({ useChatConversation: () => ({ chat: null, messages: [] }) }));
const result = (name: string, args: Record<string, unknown>): Message => ({
  role: "user",
  content: [
    {
      type: "tool_result",
      name,
      id: name,
      arguments: JSON.stringify(args),
      result: [{ type: "text", text: JSON.stringify({ success: true, path: args.file_path }) }],
    },
  ],
});

describe("memory operations in chat", () => {
  it.each([
    ["read", "Read memory"],
    ["create", "Remembered"],
    ["edit", "Updated memory"],
    ["delete", "Forgot memory"],
    ["move", "Organized memory"],
    ["grep", "Searched memory"],
    ["glob", "Searched memory"],
  ])("renders %s with a memory icon even without an active provider", (operation, label) => {
    const args = {
      file_path: "/.memory/preferences/writing.md",
      path: "/.memory",
      from: "/.memory/old.md",
      to: "/.memory/new.md",
      edits: [{ file_path: "/.memory/preferences/writing.md", old_string: "old", new_string: "new" }],
    };
    const header = resolveToolHeader(undefined, `artifacts_${operation}`, JSON.stringify(args), {});
    expect(header.label).toBe(label);
    expect(header.Icon).toBe(BrainCircuit);
    expect(header.preview).not.toContain("/.memory");
    const html = renderToString(<ChatToolMessage message={result(`artifacts_${operation}`, args)} index={0} />);
    expect(html).toContain(label);
    expect(html).toContain("lucide-brain-circuit");
  });

  it("shows running and failure states and leaves ordinary files alone", () => {
    const raw = JSON.stringify({ file_path: "/.memory/note.md" });
    expect(resolveToolHeader(undefined, "artifacts_create", raw, { running: true }).label).toBe("Remembering…");
    expect(resolveToolHeader(undefined, "artifacts_create", raw, { error: true }).label).toBe("Could not remember");
    const tool: Tool = {
      name: "artifacts_read",
      parameters: {},
      function: async () => [],
      display: { header: () => ({ icon: FileText, label: "Read file" }) },
    };
    expect(resolveToolHeader(tool, tool.name, '{"file_path":"/report.md"}', {}).label).toBe("Read file");
  });

  it("separates memory in collapsed groups and never creates memory artifact chips", () => {
    const messages = [
      result("artifacts_read", { file_path: "/.memory/preferences/writing.md" }),
      result("artifacts_create", { file_path: "/.memory/preferences/writing.md" }),
      result("artifacts_delete", { file_path: "/.memory/old.md" }),
      result("artifacts_create", { file_path: "/report.md" }),
    ];
    expect(collectTurnArtifactPaths(messages, 3)).toEqual(["/report.md"]);
    expect(summarizeToolGroup(messages, [0, 1, 2, 3])).toBe(
      "Edited 1 file, Read 1 memory note, Updated 1 memory note, Forgot 1 memory note",
    );
  });
});
