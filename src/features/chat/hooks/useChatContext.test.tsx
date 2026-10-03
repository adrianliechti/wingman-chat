import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, ToolProvider } from "@/shared/types/chat";
import { createSkillsProvider } from "@/features/skills/lib/skillsProvider";
import { useChatContext, type ChatContext } from "./useChatContext";

const state = vi.hoisted(() => ({
  client: { listModels: vi.fn(async () => []) },
  activeFile: "/first.md",
  providers: [] as ToolProvider[],
  coreProviders: [] as ToolProvider[],
  renderer: undefined as { model: string } | undefined,
  agent: null as { model: string } | null,
}));
vi.mock("@/features/agent/hooks/useAgents", () => ({ useAgents: () => ({ currentAgent: state.agent }) }));
vi.mock("@/features/settings/hooks/useProfile", () => ({
  useProfile: () => ({ generateInstructions: () => "Profile instructions" }),
}));
vi.mock("@/features/tools/lib/llmCommand", () => ({ setModel: vi.fn() }));
vi.mock("@/shared/config", () => ({
  getConfig: () => ({ client: state.client, chat: {}, renderer: state.renderer, models: [] }),
}));
vi.mock("@/features/artifacts/hooks/useArtifacts", () => ({ useArtifacts: () => ({ fs: null }) }));
vi.mock("@/features/tools/hooks/useToolsContext", () => ({
  useToolsContext: () => ({
    providers: state.providers,
    coreProviders: state.coreProviders,
    getProviderState: () => "connected",
  }),
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

function context(
  model: Model = { id: "test", name: "Test" },
  mode: "chat" | "voice" = "chat",
  models: Model[] = [],
): ChatContext {
  let result!: ChatContext;
  function Harness() {
    result = useChatContext(mode, model, models);
    return null;
  }
  renderToString(<Harness />);
  return result;
}

describe("chat prompt context", () => {
  beforeEach(() => {
    state.activeFile = "/first.md";
    state.providers = [];
    state.coreProviders = [];
    state.renderer = undefined;
    state.agent = null;
  });

  it("uses a retired agent model's replacement tool policy in voice mode", () => {
    state.agent = { model: "legacy" };
    const voice = context({ id: "realtime", name: "Voice" }, "voice", [
      {
        id: "replacement",
        name: "Replacement",
        replaces: ["legacy"],
        tools: { enabled: [], disabled: ["artifacts"] },
      },
    ]);
    expect(voice.instructions()).not.toContain("Static artifact instructions");
    expect(voice.runtimeContext()).toBe("");
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

  it("selects native chat middleware and realtime tools under the same provider policy", async () => {
    state.providers = [
      createSkillsProvider(
        [{ name: "reports", description: "Create reports", loadContent: () => "Verify every report." }],
        { id: "skills", name: "Skills", description: "Fixture" },
      )!,
    ];
    const chat = context();
    expect(chat.middleware()).toHaveLength(1);
    expect(chat.instructions()).not.toContain("Create reports"); // Native middleware supplies the catalog.
    expect(chat.tools().map((tool) => tool.name)).toEqual(["ask_questions", "agent"]);
    const voice = context(undefined, "voice");
    expect(voice.middleware()).toEqual([]);
    expect(voice.instructions()).toContain("Create reports");
    expect(voice.tools().map((tool) => tool.name)).toContain("load_skill");
    const disabled = context({ id: "test", name: "Test", tools: { enabled: [], disabled: ["skills"] } });
    expect(disabled.middleware()).toEqual([]);
    expect(disabled.tools().map((tool) => tool.name)).toEqual(["ask_questions"]);
    expect(disabled.instructions()).not.toContain("Create reports");
  });

  it("does not expose editor context when the model excludes artifact tools", () => {
    const disabled = context({
      id: "test",
      name: "Test",
      tools: { enabled: [], disabled: ["artifacts"] },
    });
    expect(disabled.instructions()).not.toContain("Static artifact instructions");
    expect(disabled.runtimeContext()).toBe("");
  });

  it("keeps Skill Builder available when the model excludes it", async () => {
    state.coreProviders = [
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

    const disabled = context({
      id: "test",
      name: "Test",
      tools: { enabled: [], disabled: ["skill-builder"] },
    });
    expect(disabled.instructions()).toContain("Skill Builder instructions");
    expect(disabled.tools()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "list_skills" })]));
  });

  it.each(["chat", "voice"] as const)(
    "makes structured questions available in %s without optional capabilities",
    async (mode) => {
      const tools = context(undefined, mode).tools();
      expect(tools.map((tool) => tool.name)).toEqual(["ask_questions"]);
      const questions = tools.find((tool) => tool.name === "ask_questions")!;
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
      expect(result).toEqual([
        { type: "text", content: JSON.stringify({ answered: true, answers: { format: "html" } }) },
      ]);
    },
  );

  it.each([
    { enabled: ["repository"], disabled: [] },
    { enabled: [], disabled: ["skills", "artifacts"] },
  ])("keeps default tools available with model provider filters %j", async (tools) => {
    state.renderer = { model: "image" };
    const available = context({ id: "test", name: "Test", tools }).tools();
    expect(available.map((tool) => tool.name)).toEqual(["create_image", "ask_questions", "agent"]);
    expect(new Set(available.map((tool) => tool.name)).size).toBe(available.length);
  });
});
