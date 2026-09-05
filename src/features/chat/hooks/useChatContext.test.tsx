import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, ToolProvider } from "@/shared/types/chat";
import { useChatContext, type ChatContext } from "./useChatContext";

const state = vi.hoisted(() => ({ activeFile: "/first.md" }));
vi.mock("@/features/agent/hooks/useAgents", () => ({ useAgents: () => ({ currentAgent: null }) }));
vi.mock("@/features/settings/hooks/useProfile", () => ({
  useProfile: () => ({ generateInstructions: () => "Profile instructions" }),
}));
vi.mock("@/features/tools/lib/llmCommand", () => ({ setModel: vi.fn() }));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ chat: {} }) }));
vi.mock("@/features/tools/hooks/useToolsContext", () => ({
  useToolsContext: () => ({ providers: [], getProviderState: () => "connected" }),
}));
vi.mock("@/features/artifacts/hooks/useArtifactsProvider", () => ({
  useArtifactsProvider: (): ToolProvider => ({
    id: "artifacts",
    name: "Artifacts",
    instructions: "Static artifact instructions",
    tools: [],
    runtimeContext: `active_file: ${state.activeFile}`,
  }),
}));

function context(model: Model = { id: "test", name: "Test" }): ChatContext {
  let result!: ChatContext;
  function Harness() {
    result = useChatContext("chat", model);
    return null;
  }
  renderToString(<Harness />);
  return result;
}

describe("chat prompt context", () => {
  beforeEach(() => {
    state.activeFile = "/first.md";
  });

  it("changing the active file leaves the complete static system instructions unchanged", () => {
    const first = context();
    const firstInstructions = first.instructions();
    const firstRuntime = first.runtimeContext();
    state.activeFile = "/second.md";
    const second = context();
    expect(second.instructions()).toBe(firstInstructions);
    expect(firstInstructions).toContain("Static artifact instructions");
    expect(firstInstructions).not.toContain("active_file");
    expect(firstRuntime).toContain("/first.md");
    expect(second.runtimeContext()).toContain("/second.md");
  });

  it("does not expose editor context when the model excludes artifact tools", () => {
    const disabled = context({ id: "test", name: "Test", tools: { enabled: [], disabled: ["artifacts"] } });
    expect(disabled.instructions()).not.toContain("Static artifact instructions");
    expect(disabled.runtimeContext()).toBe("");
  });
});
