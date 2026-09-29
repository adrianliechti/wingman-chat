// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Agent } from "../types/agent";
import { ModelSection } from "./ModelSection";

const fixture = vi.hoisted(() => ({
  updateAgent: vi.fn(),
  models: [
    { id: "fallback", name: "Fallback" },
    { id: "replacement", name: "Replacement", replaces: ["legacy"], supportedEfforts: ["low", "high"] },
  ],
}));
vi.mock("@/features/agent/hooks/useAgents", () => ({ useAgents: () => ({ updateAgent: fixture.updateAgent }) }));
vi.mock("@/features/chat/hooks/useChat", () => ({ useChatModel: () => ({ models: fixture.models }) }));
vi.mock("@/features/chat/hooks/useModels", () => ({ getSavedModelId: () => "fallback" }));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("shows a saved agent's replacement without auto-saving the unrelated app default", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  root = createRoot(container);
  const agent: Agent = {
    id: "saved",
    name: "Saved agent",
    model: "legacy",
    effort: "high",
    skills: [],
    plugins: [],
    tools: [],
    servers: [],
  };
  await act(async () => {
    root!.render(<ModelSection agent={agent} />);
  });
  expect(container.querySelector("button")?.textContent).toBe("Replacement High");
  expect(fixture.updateAgent).not.toHaveBeenCalled();
  expect(agent.model).toBe("legacy");
});
