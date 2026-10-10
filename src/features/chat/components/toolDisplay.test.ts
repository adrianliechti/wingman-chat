import { DISCOVERY_TOOL_NAME } from "@tanstack/ai";
import { describe, expect, it } from "vitest";
import { createFileTools, type WritableFileSource } from "@/shared/lib/file-tools";
import { ASK_QUESTIONS_TOOL } from "@/features/chat/lib/questionsTool";
import { resolveToolHeader, resolveToolInput } from "./toolDisplay";

const source: WritableFileSource = {
  list: async () => [],
  read: async () => undefined,
  write: async () => {},
  writeBatch: async () => {},
  remove: async () => false,
  move: async () => false,
};
const tools = createFileTools(source, { namespace: "artifacts" });
const tool = (operation: string) => tools.find((item) => item.name === `artifacts_${operation}`)!;

describe("tool headers", () => {
  it.each(["read", "create", "delete"])("shows the target for %s in every state", (operation) => {
    for (const state of [{}, { running: true }, { error: true }]) {
      for (const key of ["path", "file_path"]) {
        const args = JSON.stringify({ [key]: "/pages/dashboard.html", content: "<html>...</html>" });
        expect(resolveToolHeader(tool(operation), tool(operation).name, args, state).preview).toBe(
          "pages/dashboard.html",
        );
      }
    }
  });

  it("does not flash file content while the path is still streaming", () => {
    const create = tool("create");
    const raw = '{"content":"<html><body>A dashboard</body></html>","path"';
    for (let length = 0; length <= raw.length; length++) {
      expect(resolveToolHeader(create, create.name, raw.slice(0, length), { running: true }).preview).toBeNull();
    }
    expect(resolveToolInput(create, JSON.stringify({ path: "/index.html", content: "<html>...</html>" }))).toEqual([
      { code: "<html>...</html>", language: "html" },
    ]);
  });

  it("shows filenames and a count for batches, deduplicating repeated edits", () => {
    const edit = tool("edit");
    const args = JSON.stringify({
      edits: [{ path: "/a.md" }, { path: "/a.md" }, { path: "/b.md" }, { file_path: "/c.md" }],
    });
    expect(resolveToolHeader(edit, edit.name, args, {})).toMatchObject({
      label: "Edited files",
      preview: "3 files: a.md, b.md",
    });
    expect(resolveToolHeader(edit, edit.name, '{"edits":[{"path":"/budget files"}]}', {}).label).toBe("Edited file");
  });

  it("counts distinct files before shortening long paths", () => {
    const prefix = `/reports/${"long-folder-".repeat(20)}/`;
    const args = JSON.stringify({ edits: [{ path: `${prefix}a.md` }, { path: `${prefix}b.md` }] });
    const edit = tool("edit");
    const header = resolveToolHeader(edit, edit.name, args, {});
    expect(header.label).toBe("Edited files");
    expect(header.preview).toMatch(/^2 files:/);
  });

  it("shows source and destination for moves, including partial arguments", () => {
    const move = tool("move");
    expect(
      resolveToolHeader(move, move.name, '{"from":"/old.html","to":"/pages/new.html"}', { running: true }),
    ).toMatchObject({ label: "Moving file…", preview: "old.html → pages/new.html" });
    expect(resolveToolHeader(move, move.name, '{"from":"/old.html"', { running: true }).preview).toBe("old.html");
    expect(resolveToolHeader(tool("delete"), "artifacts_delete", '{"path":"/old.html"}', { running: true }).label).toBe(
      "Deleting file…",
    );
  });

  it("shows search patterns with their scope", () => {
    expect(
      resolveToolHeader(tool("grep"), "artifacts_grep", '{"pattern":"TODO","path":"/src","glob":"*.ts"}', {}).preview,
    ).toBe("TODO in src, *.ts");
    expect(
      resolveToolHeader(tool("glob"), "artifacts_glob", '{"pattern":"*.md","path":"/notes"}', { running: true }),
    ).toMatchObject({ label: "Finding files…", preview: "*.md in notes" });
  });

  it("lets a tool explicitly hide a generic preview and normalizes custom previews", () => {
    const hidden = { ...tool("create"), display: { header: () => ({ preview: null }) } };
    expect(resolveToolHeader(hidden, hidden.name, '{"prompt":"generic text"}', {}).preview).toBeNull();
    const custom = { ...hidden, display: { header: () => ({ preview: "  one\n two  " }) } };
    expect(resolveToolHeader(custom, custom.name, "{}", {}).preview).toBe("one two");
    const suppressed = { ...hidden, display: { header: () => ({ preview: "detail", suppressPreview: true }) } };
    expect(resolveToolHeader(suppressed, suppressed.name, "{}", {}).preview).toBeNull();
  });

  it("previews actual questions instead of form instructions", () => {
    const args = JSON.stringify({
      message: "Please answer to help me",
      questions: [{ label: "Who is the audience?" }],
    });
    expect(resolveToolHeader(ASK_QUESTIONS_TOOL, "ask_questions", args, {})).toMatchObject({
      label: "Asked a question",
      preview: "Who is the audience?",
    });
    expect(
      resolveToolHeader(
        ASK_QUESTIONS_TOOL,
        "ask_questions",
        JSON.stringify({ questions: [{ label: "Audience?" }, { label: "Tone?" }] }),
        {},
      ),
    ).toMatchObject({ label: "Asked questions", preview: "2 questions: Audience?, Tone?" });
  });

  it("uses compact discovery previews and hides raw content for inactive tools", () => {
    expect(
      resolveToolHeader(undefined, DISCOVERY_TOOL_NAME, '{"toolNames":["artifacts_read"]}', {}).preview,
    ).toBeTruthy();
    expect(resolveToolHeader(undefined, "external_tool", '{"content":"<html>...</html>"}', {}).preview).toBeNull();
    expect(
      resolveToolHeader(undefined, "artifacts_create", '{"file_path":"/old.html","content":"<html>...</html>"}', {})
        .preview,
    ).toBe("old.html");
  });
});
