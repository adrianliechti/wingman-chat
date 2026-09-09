import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, ToolProvider } from "@/shared/types/chat";
import { compileToolRegistry } from "@/shared/lib/toolRegistry";
import { useStudioProvider } from "@/features/studio/hooks/useStudioProvider";
import { useChatContext, type ChatContext } from "./useChatContext";

const state = vi.hoisted(() => ({
  activeFile: "/first.md",
  providers: [] as ToolProvider[],
  studio: false,
  renderer: undefined as { model: string } | undefined,
}));
vi.mock("@/features/agent/hooks/useAgents", () => ({ useAgents: () => ({ currentAgent: null }) }));
vi.mock("@/features/settings/hooks/useProfile", () => ({
  useProfile: () => ({ generateInstructions: () => "Profile instructions" }),
}));
vi.mock("@/features/tools/lib/llmCommand", () => ({ setModel: vi.fn() }));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ chat: {}, renderer: state.renderer, models: [] }) }));
vi.mock("@/features/artifacts/hooks/useArtifacts", () => ({ useArtifacts: () => ({ fs: null }) }));
vi.mock("@/features/tools/hooks/useToolsContext", () => ({
  useToolsContext: () => {
    const studio = useStudioProvider();
    return {
      providers: state.studio ? [...state.providers, studio] : state.providers,
      getProviderState: () => "connected",
    };
  },
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

function context(model: Model = { id: "test", name: "Test" }, mode: "chat" | "voice" = "chat"): ChatContext {
  let result!: ChatContext;
  function Harness() {
    result = useChatContext(mode, model);
    return null;
  }
  renderToString(<Harness />);
  return result;
}

describe("chat prompt context", () => {
  beforeEach(() => {
    state.activeFile = "/first.md";
    state.providers = [];
    state.studio = false;
    state.renderer = undefined;
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

  it("keeps Skill Builder available when the model excludes it", async () => {
    state.providers = [
      {
        id: "skill-builder",
        name: "Skill Builder",
        instructions: "Skill Builder instructions",
        tools: [
          {
            name: "list_skills",
            description: "List skills",
            parameters: { type: "object", properties: {} },
            function: async () => [],
          },
        ],
      },
    ];

    const disabled = context({ id: "test", name: "Test", tools: { enabled: [], disabled: ["skill-builder"] } });
    expect(disabled.instructions()).toContain("Skill Builder instructions");
    expect(await disabled.tools()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "list_skills" })]));
  });

  it.each(["chat", "voice"] as const)(
    "makes structured questions available in %s without optional capabilities",
    async (mode) => {
      const tools = await context(undefined, mode).tools();
      expect(tools.map((tool) => tool.name)).toEqual(["ask_questions"]);
      const questions = compileToolRegistry(tools).get("ask_questions")!;
      const elicit = vi.fn().mockResolvedValue({ action: "accept", content: { format: "html" } });
      const result = await questions.function(
        {
          questions: [
            {
              id: "format",
              label: "Which format?",
              type: "select",
              options: [{ value: "html", label: "Interactive HTML" }],
            },
          ],
        },
        { elicit },
      );
      expect(elicit).toHaveBeenCalledExactlyOnceWith({
        message: "A few quick questions:",
        requestedSchema: {
          type: "object",
          properties: {
            format: {
              type: "string",
              title: "Which format?",
              oneOf: [{ const: "html", title: "Interactive HTML" }],
            },
          },
        },
      });
      expect(result).toEqual([{ type: "text", text: JSON.stringify({ answered: true, answers: { format: "html" } }) }]);
    },
  );

  it.each([
    { enabled: ["repository"], disabled: [] },
    { enabled: [], disabled: ["studio", "artifacts"] },
  ])("keeps default tools available with model provider filters %j", async (tools) => {
    state.renderer = { model: "image" };
    const available = await context({ id: "test", name: "Test", tools }).tools();
    expect(available.map((tool) => tool.name)).toEqual(["create_image", "ask_questions", "agent"]);
    expect(() => compileToolRegistry(available)).not.toThrow();
  });

  it("enabling Studio adds its instructions without duplicating default tools", async () => {
    state.renderer = { model: "image" };
    const defaults = await context().tools();
    state.studio = true;
    const studio = context();
    const tools = await studio.tools();
    expect(tools.map((tool) => tool.name)).toEqual(defaults.map((tool) => tool.name));
    expect(() => compileToolRegistry(tools)).not.toThrow();
    expect(studio.instructions()).toContain("## Studio");
  });
});
