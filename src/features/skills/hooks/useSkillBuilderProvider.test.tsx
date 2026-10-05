// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsProvider } from "../context/SkillsProvider";
import type { Skill } from "../lib/skillParser";
import type { ToolProvider } from "@/shared/types/chat";
import { useSkillBuilderProvider } from "./useSkillBuilderProvider";

const storage = vi.hoisted(() => ({ load: vi.fn(), store: vi.fn() }));
vi.mock("@/shared/lib/opfs", () => ({
  loadAllSkills: storage.load,
  saveSkill: storage.store,
}));
type AgentState = { id: string; name: string; skills: string[] };
const agents = vi.hoisted(() => ({
  // Frozen render-time snapshot, like React state; getAgent reads the live store.
  stale: { id: "a1", name: "Agent", skills: [] } as AgentState,
  live: { id: "a1", name: "Agent", skills: [] } as AgentState,
  active: true,
}));
vi.mock("@/features/agent/hooks/useAgents", () => ({
  useAgents: () => ({
    currentAgent: agents.active ? agents.stale : null,
    getAgent: () => agents.live,
    updateAgent: (_id: string, updates: { skills: string[] }) => {
      agents.live = { ...agents.live, ...updates };
    },
  }),
}));

const personal: Skill = {
  id: "personal-html",
  name: "html-artifacts",
  description: "Personal HTML workflow",
  content: "Keep this complete body, including the uncommon final instruction.",
  compatibility: "Workspace tools",
  resources: [{ path: "references/team.md", content: "Reference body" }],
};
let root: Root;
let value: ToolProvider;
function Harness() {
  value = useSkillBuilderProvider();
  return null;
}
async function call(provider: ToolProvider, name: string, args: Record<string, unknown> = {}) {
  const result = await provider.tools.find((tool) => tool.name === name)!.execute(args);
  const text = result.find((part) => part.type === "text");
  if (text?.type !== "text") throw new Error("Expected tool text");
  return JSON.parse(text.content);
}

beforeEach(async () => {
  vi.clearAllMocks();
  agents.live = { id: "a1", name: "Agent", skills: [] };
  agents.active = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage.load.mockResolvedValue([structuredClone(personal)]);
  storage.store.mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <SkillsProvider>
        <Harness />
      </SkillsProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("personal skill reads for editing", () => {
  it("lists metadata and reads the full personal entry without requiring activation", async () => {
    expect(await call(value, "list_skills")).toEqual({
      skills: [{ name: personal.name, description: personal.description }],
    });
    const expected = {
      skill: {
        name: personal.name,
        description: personal.description,
        content: personal.content,
        compatibility: personal.compatibility,
        resources: ["references/team.md"],
      },
    };
    expect(await call(value, "list_skills", { name: "html-artifacts" })).toEqual(expected);
    expect(await call(value, "list_skills", { name: "html-artifacts" })).toEqual(expected);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it("keeps reads current across edits using the same running turn's tool callbacks", async () => {
    const runningTurn = value;
    await act(async () => {
      await call(runningTurn, "update_skill", { name: personal.name, content: "Revised full body" });
    });
    expect(await call(runningTurn, "list_skills", { name: personal.name })).toMatchObject({
      skill: { content: "Revised full body", description: personal.description, resources: ["references/team.md"] },
    });
    await act(async () => {
      await call(runningTurn, "update_skill", { name: personal.name, description: "Revised description" });
    });
    expect(await call(runningTurn, "list_skills", { name: personal.name })).toMatchObject({
      skill: { content: "Revised full body", description: "Revised description" },
    });
  });

  it("can read a skill created in the same turn and prevents a duplicate creation", async () => {
    const runningTurn = value;
    const draft = { name: "new-workflow", description: "A reusable workflow", content: "Full instructions" };
    await act(async () => {
      expect(await call(runningTurn, "create_skill", draft)).toMatchObject({ success: true });
    });
    expect(await call(runningTurn, "list_skills", { name: draft.name })).toMatchObject({ skill: draft });
    expect(await call(runningTurn, "create_skill", draft)).toMatchObject({
      error: expect.stringContaining("already exists"),
    });
  });

  it.each(["missing", "", 42, null])("returns an error for an invalid personal skill lookup (%j)", async (name) => {
    expect(await call(value, "list_skills", { name })).toMatchObject({ error: expect.any(String) });
    expect(storage.store).not.toHaveBeenCalled();
  });

  it("enables every skill created in one turn on the active agent", async () => {
    const runningTurn = value;
    for (const name of ["one", "two", "three"]) {
      await act(async () => {
        await call(runningTurn, "create_skill", { name, description: "A reusable workflow", content: "Body" });
      });
    }
    expect(agents.live.skills).toEqual(["one", "two", "three"]);
  });

  it("reports the agent on delete only when the skill was enabled on it", async () => {
    let result: unknown;
    await act(async () => {
      result = await call(value, "delete_skill", { name: personal.name });
    });
    expect(result).toMatchObject({ success: true, removedFromAgent: null });

    agents.live = { ...agents.live, skills: ["one"] };
    await act(async () => {
      await call(value, "create_skill", { name: "one", description: "A reusable workflow", content: "Body" });
      result = await call(value, "delete_skill", { name: "one" });
    });
    expect(result).toMatchObject({ success: true, removedFromAgent: "Agent" });
    expect(agents.live.skills).toEqual([]);
  });
});
