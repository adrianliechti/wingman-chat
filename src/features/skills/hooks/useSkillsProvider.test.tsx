import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@/features/agent/types/agent";
import type { InstalledPlugin } from "@/features/plugins/lib/types";
import type { ParsedSkill } from "@/features/skills/lib/skillParser";
import { SKILLS_PROVIDER_ID } from "@/features/skills/lib/skillsProvider";
import type { SkillTemplate } from "@/features/skills/lib/templates";
import { setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import type { ToolProvider } from "@/shared/types/chat";
import { useSkillsProvider } from "./useSkillsProvider";

const state = vi.hoisted(() => ({
  skills: [] as ParsedSkill[],
  templates: [] as SkillTemplate[],
  loadTemplate: vi.fn(),
  loadResource: vi.fn(),
}));
vi.mock("./useSkills", () => ({ useSkills: () => ({ skills: state.skills }) }));
vi.mock("./useSkillTemplates", () => ({
  useSkillTemplates: () => ({ templates: state.templates, loadTemplate: state.loadTemplate }),
}));
vi.mock("@/features/skills/lib/templates", () => ({
  loadSkillResource: (...args: unknown[]) => state.loadResource(...args),
}));

const agent = (skills: string[] = []): Agent => ({
  id: "agent",
  name: "Agent",
  skills,
  plugins: [],
  tools: [],
  servers: [],
});
function provider(current: Agent | null = null, personal = false, plugins: InstalledPlugin[] = []) {
  let result: ToolProvider | null = null;
  function Harness() {
    result = useSkillsProvider(current, { personal }, plugins);
    return null;
  }
  renderToString(<Harness />);
  return result! as ToolProvider;
}
function catalog(value: ToolProvider) {
  const load = value.tools.find((tool) => tool.name === "load_skill")!;
  return load.parameters;
}
async function read(value: ToolProvider, name: string) {
  return value.tools.find((tool) => tool.name === "load_skill")!.function({ name });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.skills = [];
  state.templates = [
    {
      name: "html-artifacts",
      description: "HTML runtime",
      category: "studio",
      path: "/skills/studio/html-artifacts/SKILL.md",
      resources: ["references/sdk.md"],
    },
    {
      name: "specialist",
      description: "Optional template",
      category: "finance",
      path: "/skills/finance/specialist/SKILL.md",
    },
  ];
  state.loadTemplate.mockResolvedValue({ content: "Built-in HTML instructions." });
  state.loadResource.mockResolvedValue("SDK reference.");
});
afterEach(() => setSkillResourceResolver(SKILLS_PROVIDER_ID, null));

describe("default capability skills", () => {
  it.each([null, agent()])("exposes built-ins without personal skills or selected tools (%j)", async (current) => {
    const value = provider(current);
    expect(catalog(value)).toMatchObject({ properties: { name: { enum: ["html-artifacts"] } } });
    expect(state.loadTemplate).not.toHaveBeenCalled();
    expect(state.loadResource).not.toHaveBeenCalled();

    expect(await read(value, "html-artifacts")).toEqual([
      { type: "text", text: expect.stringContaining("Built-in HTML instructions.") },
    ]);
    expect(state.loadTemplate).toHaveBeenCalledExactlyOnceWith("/skills/studio/html-artifacts/SKILL.md");
    const resource = value.tools.find((tool) => tool.name === "read_skill_resource")!;
    expect(await resource.function({ skill: "html-artifacts", path: "references/sdk.md" })).toEqual([
      { type: "text", text: expect.stringContaining("SDK reference.") },
    ]);
    expect(state.loadResource).toHaveBeenCalledExactlyOnceWith(
      "/skills/studio/html-artifacts/SKILL.md",
      "references/sdk.md",
    );
    expect(value.chat!.middleware).toHaveLength(1);
  });

  it("lets enabled personal skills override a built-in without duplicating the catalog", async () => {
    state.skills = [
      { name: "html-artifacts", description: "Personal HTML", content: "Personal instructions." },
      { name: "private-notes", description: "Private", content: "Notes." },
    ];
    expect(catalog(provider())).toMatchObject({ properties: { name: { enum: ["html-artifacts"] } } });
    const value = provider(null, true);
    expect(catalog(value)).toMatchObject({
      properties: { name: { enum: ["html-artifacts", "private-notes"] } },
    });
    expect(await read(value, "html-artifacts")).toEqual([
      { type: "text", text: expect.stringContaining("Personal instructions.") },
    ]);
    expect(state.loadTemplate).not.toHaveBeenCalled();
  });

  it("uses only an agent's curated personal skills while retaining built-ins and qualified plugin skills", async () => {
    state.skills = [
      { name: "html-artifacts", description: "Personal HTML", content: "Personal instructions." },
      { name: "private-notes", description: "Private", content: "Notes." },
    ];
    const value = provider(agent(["private-notes"]), true, [
      {
        id: "extension",
        hubUrl: "https://example.test",
        installedAt: "2026-01-01",
        skills: [{ name: "html-artifacts", description: "Plugin HTML", content: "Plugin instructions." }],
      },
    ]);
    expect(catalog(value)).toMatchObject({
      properties: { name: { enum: ["html-artifacts", "private-notes", "extension:html-artifacts"] } },
    });
    expect(await read(value, "html-artifacts")).toEqual([
      { type: "text", text: expect.stringContaining("Built-in HTML instructions.") },
    ]);
    expect(await read(value, "extension:html-artifacts")).toEqual([
      { type: "text", text: expect.stringContaining("Plugin instructions.") },
    ]);
  });
});
