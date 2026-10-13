import type { UIMessage } from "@tanstack/ai";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { run as runAgent } from "../agent";
import { calls, output, testClient } from "../test-support/ai";
import { assistantMessage, userMessage } from "../messages";
import { submissionText, uiDiagnostics } from "./diagnostics";
import type { UiSubmission } from "./runtime";
import fixtures from "./fixtures/components.json";
import { WINGMAN_CATALOG_ID } from "./catalog";
const run = (messages: UIMessage[]) => {
  const middleware = uiDiagnostics(messages);
  const invoke = () =>
    middleware.onConfig?.(
      { phase: "beforeModel" } as never,
      { messages: [{ role: "user", content: "Continue" }] } as never,
    ) as { providerMessages: { role: string; content: string }[] } | undefined;
  return { first: invoke(), second: invoke() };
};
it("forwards structured action context on every model request without changing visible history", () => {
  const submission: UiSubmission = {
    message: {
      version: "v1.0",
      action: {
        name: "save",
        userMessage: "Save my choices",
        surfaceId: "main",
        sourceComponentId: "button",
        timestamp: "2026-10-11T12:00:00Z",
        context: { seats: 12 },
      },
    },
    metadata: { a2uiRendererCapabilities: { supportedVersions: ["v1.0"] } },
  };
  expect(submissionText(submission)).toBe("Save my choices");
  const messages = [userMessage(submissionText(submission), { metadata: { a2ui: submission } })];
  const original = structuredClone(messages);
  const { first, second } = run(messages);
  expect(first?.providerMessages[0].content).toContainEqual({
    type: "text",
    content: expect.stringContaining(JSON.stringify(submission)),
  });
  expect(second).toEqual(first);
  expect(messages).toEqual(original);
});
it("reports invalid UI and stays silent for valid history", () => {
  const { first, second } = run([assistantMessage('```ui\n{"children":[]}\n```'), userMessage("Fix it")]);
  expect(first?.providerMessages[0].content).toContainEqual({
    type: "text",
    content: expect.stringContaining("A2UI diagnostics"),
  });
  expect(second).toBeUndefined();
  expect(
    run([assistantMessage("```ui\n" + JSON.stringify(fixtures.Text) + "\n```"), userMessage("Thanks")]).first,
  ).toBeUndefined();
});

it("gives a precise visibility repair for invalid Basic Text without rewriting the transcript", () => {
  const invalid = structuredClone(fixtures.Text);
  const text = invalid.createSurface.components[0];
  Object.assign(text, { id: "drawtext", visible: true });
  const messages = [assistantMessage("```ui\n" + JSON.stringify(invalid) + "\n```"), userMessage("Fix it")];
  const original = structuredClone(messages);
  const { first, second } = run(messages);
  expect(first?.providerMessages[0].content).toContainEqual({
    type: "text",
    content: expect.stringContaining("Visibility repair: Basic components such as Text, Row and Column"),
  });
  expect(first?.providerMessages[0].content).toContainEqual({
    type: "text",
    content: expect.stringContaining(WINGMAN_CATALOG_ID),
  });
  expect(second).toBeUndefined();
  expect(messages).toEqual(original);
});

it("forwards a missing Heading catalog repair once without rewriting the transcript", () => {
  const invalid = structuredClone(fixtures.Heading);
  delete invalid.createSurface.components[0].catalogId;
  const messages = [assistantMessage("```ui\n" + JSON.stringify(invalid) + "\n```"), userMessage("Fix it")];
  const original = structuredClone(messages);
  const { first, second } = run(messages);
  expect(first?.providerMessages[0].content).toContainEqual({
    type: "text",
    content: expect.stringContaining(`Catalog repair: Heading requires catalogId "${WINGMAN_CATALOG_ID}"`),
  });
  expect(second).toBeUndefined();
  expect(messages).toEqual(original);
});

it("retains action values throughout a real tool continuation", async () => {
  const submission: UiSubmission = {
    message: {
      version: "v1.0",
      action: {
        name: "save",
        surfaceId: "main",
        sourceComponentId: "button",
        timestamp: "2026-10-11T12:00:00Z",
        context: { destination: "Vaduz", seats: 12 },
      },
    },
    metadata: { a2uiRendererCapabilities: { supportedVersions: ["v1.0"] } },
  };
  const messages = [userMessage("Save", { metadata: { a2ui: submission } })];
  const requests: string[] = [];
  const complete = vi.fn<Parameters<typeof testClient>[0]>().mockImplementation(async ({ messages }) => {
    requests.push(messages.map((message) => JSON.stringify(message.content)).join("\n"));
    return requests.length === 1 ? calls(["read", "lookup", {}]) : assistantMessage("Saved");
  });
  const result = await runAgent(
    testClient(complete),
    "model",
    "",
    messages,
    [
      {
        name: "lookup",
        description: "Read context",
        inputSchema: z.strictObject({}),
        execute: async () => output("Ready"),
      },
    ],
    { middleware: [uiDiagnostics(messages)] },
  );
  expect(result.status).toBe("completed");
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request).toContain("Vaduz");
    expect(request.match(/a2uiRendererCapabilities/g)).toHaveLength(1);
  }
});

it("forwards schema-derived attribute repairs only once without changing the transcript", () => {
  const invalid = structuredClone(fixtures.Row);
  Object.assign(invalid.createSurface.components[0], { gap: "md" });
  const messages = [assistantMessage("```ui\n" + JSON.stringify(invalid) + "\n```"), userMessage("Fix it")];
  const original = structuredClone(messages);
  const { first, second } = run(messages);
  expect(first?.providerMessages[0].content).toContainEqual({
    type: "text",
    content: expect.stringContaining("Attribute repair: Row.gap is unsupported"),
  });
  expect(first?.providerMessages[0].content).toContainEqual({
    type: "text",
    content: expect.stringContaining(WINGMAN_CATALOG_ID),
  });
  expect(second).toBeUndefined();
  expect(messages).toEqual(original);
});
