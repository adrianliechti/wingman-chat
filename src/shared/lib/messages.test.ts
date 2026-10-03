import { feedbackMessage } from "@/shared/lib/test-support/ai";
import type { ToolCallPart, ToolResultPart } from "@tanstack/ai";
import { describe, expect, it } from "vitest";
import { RunSidecar } from "./agent";
import {
  artifactRefPart,
  artifactSelectionPart,
  assistantMessage,
  describeToolOutput,
  finalText,
  isUserPrompt,
  mediaDataUrl,
  mediaFromDataUrl,
  messageMetadata,
  messageText,
  outputText,
  promptText,
  text,
  textSegments,
  toolResultFor,
  toolResultContent,
  toolResultMetadata,
  toolRoundMessage,
  updateToolResultMeta,
  userMessage,
} from "./messages";

describe("constructors", () => {
  it("builds user and assistant turns with identity and a date", () => {
    const message = userMessage("Hello");
    expect(message).toMatchObject({ role: "user", parts: [{ type: "text", content: "Hello" }] });
    expect(message.id).toEqual(expect.any(String));
    expect(message.createdAt).toBeInstanceOf(Date);
    expect(assistantMessage("Hi", { id: "a", metadata: { runId: "run" } })).toMatchObject({
      id: "a",
      role: "assistant",
      metadata: { runId: "run" },
    });
  });

  it("marks references, selections and feedback for the UI while the model reads prose", () => {
    const ref = artifactRefPart({ path: "/notes.md", displayName: "notes.md" });
    expect(ref.content).toBe("\nWorkspace file: /notes.md");
    expect(ref.metadata).toEqual({ artifactRef: { path: "/notes.md", displayName: "notes.md" } });
    const selection = artifactSelectionPart({ path: "/a.md", text: "code ``` fence", startLine: 3, endLine: 4 });
    expect(selection.content).toBe("\nSelected text in /a.md (lines 3-4):\n````\ncode ``` fence\n````");
    expect(selection.metadata).toEqual({
      artifactSelection: { path: "/a.md", text: "code ``` fence", startLine: 3, endLine: 4 },
    });
    const feedback = feedbackMessage("Fix it", "verification");
    expect(feedback).toMatchObject({ role: "user", metadata: { kind: "runtime_feedback" } });
    expect(isUserPrompt(feedback)).toBe(false);
    expect(isUserPrompt(userMessage("Hi"))).toBe(true);
    expect(isUserPrompt(assistantMessage("Hi"))).toBe(false);
  });

  it("builds a completed tool round the model reads as text and the UI as rich output", () => {
    const image = mediaFromDataUrl("data:image/png;base64,AQ==", "chart.png");
    const round = toolRoundMessage({ id: "call", name: "render", arguments: "{}" }, [text("Drawn"), image]);
    expect(round.parts[0]).toMatchObject({ type: "tool-call", id: "call", name: "render", state: "complete" });
    expect(toolResultFor(round, "call")).toMatchObject({
      state: "complete",
      content: "Drawn\n[Image: chart.png - displayed to user]",
    });
    expect(toolResultMetadata(toolResultFor(round, "call")!).result).toEqual([text("Drawn"), image]);
  });
});

describe("readers", () => {
  it("reads native tool content when no rich app output was attached", () => {
    const result: ToolResultPart = {
      type: "tool-result",
      toolCallId: "skill",
      state: "complete",
      content: "Skill instructions",
    };
    expect(toolResultContent(result)).toEqual([text("Skill instructions")]);
    const media = [mediaFromDataUrl("data:image/png;base64,AQ==")];
    expect(toolResultContent({ ...result, content: media })).toBe(media);
    expect(toolResultContent({ ...result, metadata: { result: media } })).toBe(media);
  });

  it("separates typed prose from references and keeps the provider text intact", () => {
    const message = userMessage([text("Edit this"), artifactRefPart({ path: "/a.md" })]);
    expect(promptText(message)).toBe("Edit this");
    expect(messageText(message)).toBe("Edit this\nWorkspace file: /a.md");
  });

  it("prefers the gateway's phases over text parts and picks the final answer", () => {
    const plain = assistantMessage([text("Working", { phase: "commentary" }), text("Done", { phase: "final_answer" })]);
    expect(textSegments(plain)).toEqual([
      { content: "Working", phase: "commentary" },
      { content: "Done", phase: "final_answer" },
    ]);
    expect(finalText(plain)).toBe("Done");
    const segmented = assistantMessage("WorkingDone", {
      metadata: {
        textSegments: [
          { content: "Working", phase: "commentary" },
          { content: "Done", phase: "final_answer" },
        ],
      },
    });
    expect(finalText(segmented)).toBe("Done");
    expect(finalText(assistantMessage("Only answer"))).toBe("Only answer");
    expect(finalText(assistantMessage([text("A", { phase: "commentary" })]))).toBe("");
  });

  it("describes media for the model and extracts text for display hooks", () => {
    const output = [
      text("Created"),
      mediaFromDataUrl("data:image/png;base64,AQ==", "chart.png"),
      mediaFromDataUrl("data:audio/wav;base64,AQ==", "speech.wav"),
      mediaFromDataUrl("data:application/pdf;base64,AQ==", "notes.pdf"),
      mediaFromDataUrl("data:video/mp4;base64,AQ=="),
    ];
    expect(describeToolOutput(output)).toBe(
      [
        "Created",
        "[Image: chart.png - displayed to user]",
        "[Audio: speech.wav - displayed to user]",
        "[File: notes.pdf - displayed to user]",
        "[Video - displayed to user]",
      ].join("\n"),
    );
    expect(outputText(output)).toBe("Created");
  });
});

describe("media", () => {
  it("round-trips a data URL through a native part", () => {
    const part = mediaFromDataUrl("data:image/jpeg;base64,YWJj", "photo.jpg");
    expect(part).toEqual({
      type: "image",
      source: { type: "data", value: "YWJj", mimeType: "image/jpeg" },
      metadata: { filename: "photo.jpg", contentType: "image/jpeg" },
    });
    expect(mediaDataUrl(part)).toBe("data:image/jpeg;base64,YWJj");
    expect(mediaFromDataUrl("data:text/plain;base64,aGk=").type).toBe("document");
    expect(mediaFromDataUrl("data:image/png;base64,AQ==", undefined, "document").type).toBe("document");
    const url = mediaFromDataUrl("https://example.com/a.png");
    expect(url.source).toEqual({ type: "url", value: "https://example.com/a.png" });
    expect(mediaDataUrl(url)).toBe("https://example.com/a.png");
  });
});

describe("transforms", () => {
  const call = (id: string): ToolCallPart => ({
    type: "tool-call",
    id,
    name: "work",
    arguments: "{}",
    state: "complete",
  });
  const result = (id: string): ToolResultPart => ({
    type: "tool-result",
    toolCallId: id,
    content: "Done",
    state: "complete",
  });

  it("attaches rich results and turn data without mutating the input, recursing into subagents", () => {
    const child = assistantMessage([call("inner"), result("inner")], { id: "child" });
    const parent = assistantMessage(
      [
        call("outer"),
        result("outer"),
        { type: "subagent", subagent: { id: "s", name: "research", status: "finished", messages: [child] } },
      ],
      { id: "parent" },
    );
    const before = JSON.stringify(parent);
    const sidecar = new RunSidecar();
    sidecar.result("outer", { meta: { file: "/a" } });
    sidecar.result("inner", { result: [text("Evidence")] });
    sidecar.turn("parent", "run", { outputTokens: 1 });
    sidecar.turn("child", "run:child");
    const next = sidecar.apply([parent]);
    expect(JSON.stringify(parent)).toBe(before);
    expect(toolResultMetadata(toolResultFor(next[0], "outer")!)).toEqual({ meta: { file: "/a" } });
    expect(messageMetadata(next[0])).toEqual({ runId: "run", usage: { outputTokens: 1 } });
    const nested = next[0].parts[2];
    if (nested.type !== "subagent") throw new Error("Expected the subagent card");
    expect(toolResultMetadata(toolResultFor(nested.subagent.messages[0], "inner")!)).toEqual({
      result: [text("Evidence")],
    });
    expect(messageMetadata(nested.subagent.messages[0])).toEqual({ runId: "run:child" });
    const untouched = [parent];
    expect(new RunSidecar().apply(untouched)).toBe(untouched);
  });

  it("replaces one tool's metadata and keeps the rest of the record", () => {
    const message = assistantMessage([
      call("a"),
      { ...result("a"), metadata: { result: [text("x")], meta: { old: 1 } } },
    ]);
    const [updated] = updateToolResultMeta([message], "a", { progress: "done" });
    expect(toolResultMetadata(toolResultFor(updated, "a")!)).toEqual({
      result: [text("x")],
      meta: { progress: "done" },
    });
    expect(updateToolResultMeta([message], "missing", {})[0].parts).toEqual(message.parts);
  });
});
