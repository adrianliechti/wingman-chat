import type { UIMessage } from "@tanstack/ai";
import { expect, it } from "vitest";
import { assistantMessage, userMessage } from "../messages";
import { submissionText, uiDiagnostics } from "./diagnostics";
import type { UiSubmission } from "./runtime";
import fixtures from "./fixtures/components.json";
const run = (messages: UIMessage[]) => {
  const middleware = uiDiagnostics(messages);
  const invoke = () =>
    middleware.onConfig?.(
      { phase: "beforeModel" } as never,
      { messages: [{ role: "user", content: "Continue" }] } as never,
    ) as { providerMessages: { role: string; content: string }[] } | undefined;
  return { first: invoke(), second: invoke() };
};
it("forwards structured action context once without changing visible history", () => {
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
  expect(first?.providerMessages[1].content).toContain(JSON.stringify(submission));
  expect(second).toBeUndefined();
  expect(messages).toEqual(original);
});
it("reports invalid UI and stays silent for valid history", () => {
  expect(
    run([assistantMessage('```ui\n{"children":[]}\n```'), userMessage("Fix it")]).first?.providerMessages[1].content,
  ).toContain("A2UI diagnostics");
  expect(
    run([assistantMessage("```ui\n" + JSON.stringify(fixtures.Text) + "\n```"), userMessage("Thanks")]).first,
  ).toBeUndefined();
});
