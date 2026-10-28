// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assistantMessage } from "@/shared/lib/messages";
import type { ToolCallPart, UIMessage } from "@tanstack/ai";
import { ChatAssistantMessage } from "./ChatAssistantMessage";

vi.mock("@/features/chat/hooks/useChat", () => ({
  useChatConversation: () => ({ chat: null, messages: [message] }),
  useChatRunState: () => ({ pendingElicitation: null, status: "thinking" }),
  useChatActions: () => ({ sendMessage: vi.fn(), retryMessage: vi.fn(), resolveElicitation: vi.fn() }),
}));
vi.mock("@/features/artifacts/hooks/useArtifacts", () => ({
  useArtifacts: () => ({ openFile: vi.fn(), setShowArtifactsDrawer: vi.fn() }),
}));
vi.mock("@/features/tools/hooks/useToolsContext", () => ({ useToolsContext: () => ({ providers: [] }) }));
vi.mock("@/shared/hooks/useModelCatalog", () => ({ useModelCatalog: () => [] }));
vi.mock("@/shared/config", () => ({ getConfig: () => ({}) }));
vi.mock("@/shared/ui/Markdown", () => ({ Markdown: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock("@/shared/ui/ConvertButton", () => ({ ConvertButton: () => null }));
vi.mock("./ChatToolMessage", () => ({
  ChatToolMessage: ({ call }: { call: ToolCallPart }) => <div data-tool>{call.name}</div>,
}));

let root: Root, container: HTMLDivElement, message: UIMessage;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  message = assistantMessage([
    { type: "tool-call", id: "skill", name: "load_skill", arguments: "{}", state: "complete" },
    { type: "tool-result", toolCallId: "skill", content: "", state: "complete" },
    { type: "thinking", stepId: "earlier", content: "Read the resource" },
    { type: "tool-call", id: "resource", name: "read_skill_resource", arguments: "{}", state: "complete" },
    { type: "tool-result", toolCallId: "resource", content: "", state: "complete" },
    { type: "thinking", stepId: "current", content: "Think after the tools" },
  ]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([false, true])("keeps tool and thinking rows in arrival order with text=%s", async (withText) => {
  if (withText) message = { ...message, parts: [{ type: "text", content: "Starting work" }, ...message.parts] };
  await act(async () => root.render(<ChatAssistantMessage message={message} index={0} isLast isResponding />));
  expect([...container.querySelectorAll("[data-tool], button[aria-expanded]")].map((row) => row.textContent)).toEqual([
    "load_skill",
    "Thought",
    "read_skill_resource",
    "Thinking…",
  ]);
  expect(container.textContent).toContain("Think after the tools");
  expect(container.textContent).not.toContain("Read the resource");
  await act(async () => root.render(<ChatAssistantMessage message={message} index={0} isLast />));
  expect([...container.querySelectorAll("[data-tool], button[aria-expanded]")].map((row) => row.textContent)).toEqual([
    "load_skill",
    "Thought",
    "read_skill_resource",
    "Thought",
  ]);
  expect(container.textContent).not.toContain("Think after the tools");
});

it("gives a reply no top padding when it opens with activity rows", async () => {
  const trailingText: UIMessage = { ...message, parts: [...message.parts, { type: "text", content: "Done" }] };
  await act(async () => root.render(<ChatAssistantMessage message={trailingText} index={0} isLast />));
  expect(container.querySelector("div.flex-1")?.className).toContain("pb-3");

  const leadingText: UIMessage = { ...message, parts: [{ type: "text", content: "Starting" }, ...message.parts] };
  await act(async () => root.render(<ChatAssistantMessage message={leadingText} index={0} isLast />));
  expect(container.querySelector("div.flex-1")?.className).toContain("py-3");
});

it("keeps the working indicator visible after tools return while waiting for the model", async () => {
  message = { ...message, parts: message.parts.slice(0, -1) };
  await act(async () => root.render(<ChatAssistantMessage message={message} index={0} isLast isResponding />));
  const rows = [...container.querySelectorAll("[data-tool], button[aria-expanded]")];
  expect(rows.slice(0, 3).map((row) => row.textContent)).toEqual(["load_skill", "Thought", "read_skill_resource"]);
  expect(container.textContent).not.toContain("Read the resource");
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
});
